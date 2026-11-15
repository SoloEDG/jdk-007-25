import { beforeEach, describe, expect, it } from "vitest";
import { installFakeAudio, type FakeAudioContext } from "../../lib/__tests__/fakeAudio";
import { createEngine } from "../engine";
import type { ScheduledGroup } from "@/shared/types";

let context: FakeAudioContext;
beforeEach(() => {
  context = installFakeAudio();
});

const chord = (
  trackId: string,
  when: number,
  pitches = [60, 64, 67],
  priority = 5,
  order = 0,
): ScheduledGroup => ({
  trackId,
  when,
  priority,
  order,
  notes: pitches.map((pitch) => ({
    trackId,
    instrument: "keys" as const,
    pitch,
    velocity: 0.7,
    duration: 1,
    when,
    priority,
    order,
  })),
});

const live = (pitch: number) => ({
  trackId: "live",
  instrument: "keys" as const,
  pitch,
  velocity: 0.8,
  duration: 6,
  when: 0,
  priority: 9,
  order: 0,
});

describe("引擎声部与资源生命周期", () => {
  it("超出预算的回放整组不发声，绝不产生半个和弦", async () => {
    const engine = createEngine(3);
    await engine.unlock();
    engine.route(() => context.destination as never);
    expect(engine.playGroup(chord("a", 0))).toBe(true);
    expect(engine.playGroup(chord("b", 0))).toBe(false);
    expect(engine.voiceCount()).toBe(3);
    expect(engine.report(0).limited).toEqual([
      { trackId: "b", droppedVoices: 3, reason: "rejected" },
    ]);
  });

  it("现场按住的声音优先，低优先级回放让位", async () => {
    const engine = createEngine(3);
    await engine.unlock();
    engine.route(() => context.destination as never);
    engine.playGroup(chord("pad", 0, [60, 64, 67], 1, 0));
    expect(engine.playLive(live(72), "key:KeyH", false)).toBe(true);
    const report = engine.report(0);
    expect(report.held).toBe(1);
    expect(report.playback).toBe(0);
    expect(report.limited[0]).toMatchObject({
      trackId: "pad",
      reason: "evicted",
    });
  });

  it("录音中的声音不可被淘汰", async () => {
    const engine = createEngine(1);
    await engine.unlock();
    engine.route(() => context.destination as never);
    engine.playLive(live(72), "key:KeyH", true);
    expect(engine.playGroup(chord("other", 0))).toBe(false);
    expect(engine.report(0).recording).toBe(1);
  });

  it("静音 / 删轨立即停声并归还预算", async () => {
    const engine = createEngine(8);
    await engine.unlock();
    engine.route(() => context.destination as never);
    engine.playGroup(chord("a", 0));
    engine.playGroup(chord("b", 0));
    engine.stopTrack("a");
    expect(engine.activeFor("a")).toBe(0);
    expect(engine.report(0).active).toEqual({ b: 3 });
  });

  it("按住后松开精确释放对应声部", async () => {
    const engine = createEngine(8);
    await engine.unlock();
    engine.route(() => context.destination as never);
    engine.playLive(live(72), "key:KeyH", false);
    expect(engine.report(0).held).toBe(1);
    engine.release("key:KeyH");
    expect(engine.report(0).held).toBe(0);
  });

  it("长时间播放 + 反复暂停恢复不会累积节点或预算记账", async () => {
    const engine = createEngine(16);
    await engine.unlock();
    engine.route(() => context.destination as never);
    for (let round = 0; round < 200; round++) {
      context.currentTime = round;
      engine.playGroup(chord("loop", round, [60, 64, 67]));
      engine.sweep(round + 2);
      if (round % 10 === 0) {
        engine.cancel();
      }
    }
    engine.sweep(context.currentTime + 100);
    expect(engine.voiceCount()).toBe(0);
    expect(engine.report(context.currentTime + 100).used).toBe(0);
  });

  it("自然结束后节点被断开，图上的连接不增长", async () => {
    const engine = createEngine(64);
    await engine.unlock();
    engine.route(() => context.destination as never);
    for (let i = 0; i < 50; i++) {
      context.currentTime = i;
      engine.playGroup(chord(`t${i % 5}`, i, [60, 64, 67]));
      engine.sweep(i);
    }
    engine.sweep(1000);
    expect(context.connectedNodes()).toBe(0);
  });

  it("dispose 关闭上下文并清空所有声部", async () => {
    const engine = createEngine();
    await engine.unlock();
    engine.route(() => context.destination as never);
    engine.playGroup(chord("a", 0));
    engine.dispose();
    expect(engine.context).toBeNull();
    expect(context.connectedNodes()).toBe(0);
  });
});
