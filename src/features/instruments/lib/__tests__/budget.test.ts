import { describe, expect, it } from "vitest";
import { createVoiceBudget } from "../budget";
import type { BudgetGroupRequest } from "../budget";

let seq = 0;
const voice = (id: string, start: number, end: number) => ({ id, start, end });
const group = (
  partial: Partial<BudgetGroupRequest> & Pick<BudgetGroupRequest, "trackId">,
): BudgetGroupRequest => {
  const start = partial.start ?? 0;
  const end = partial.end ?? start + 1;
  return {
    trackId: partial.trackId,
    order: partial.order ?? 0,
    priority: partial.priority ?? 5,
    klass: partial.klass ?? "playback",
    start,
    end,
    voices:
      partial.voices ??
      Array.from({ length: 3 }, () => {
        seq += 1;
        return voice(`v${seq}`, start, end);
      }),
  };
};

describe("声部预算", () => {
  it("预算内整组接受", () => {
    const budget = createVoiceBudget(16);
    const admission = budget.admitPlayback(group({ trackId: "a" }), 0);
    expect(admission.accepted).toBe(true);
    expect(admission.voiceIds).toHaveLength(3);
    expect(budget.report(0).playback).toBe(3);
  });

  it("腾不出空间时整组拒绝，不产生半个和弦，也不乱掐别的声音", () => {
    const budget = createVoiceBudget(4);
    // 同优先级、更靠前的轨道先占住全部名额；后来的同优先级轨道无法让位。
    expect(
      budget.admitPlayback(group({ trackId: "a", order: 0 }), 0).accepted,
    ).toBe(true);
    const result = budget.admitPlayback(
      group({ trackId: "b", order: 1 }),
      0,
    );
    expect(result.accepted).toBe(false);
    expect(result.voiceIds).toHaveLength(0);
    expect(result.evictedVoiceIds).toHaveLength(0);
    expect(budget.report(0).playback).toBe(3);
    expect(budget.report(0).active).toEqual({ a: 3 });
    expect(budget.report(0).limited).toEqual([
      { trackId: "b", droppedVoices: 3, reason: "rejected" },
    ]);
  });

  it("低优先级轨道让位，高优先级和弦完整保留", () => {
    const budget = createVoiceBudget(4);
    budget.admitPlayback(group({ trackId: "low", priority: 2, order: 0 }), 0);
    const high = budget.admitPlayback(
      group({ trackId: "high", priority: 9, order: 1 }),
      0,
    );
    expect(high.accepted).toBe(true);
    expect(high.evictedVoiceIds).toHaveLength(3);
    const report = budget.report(0);
    expect(report.playback).toBe(3);
    expect(report.active).toEqual({ high: 3 });
    expect(report.limited).toEqual([
      { trackId: "low", droppedVoices: 3, reason: "evicted" },
    ]);
  });

  it("现场按住的声音永不因预算被掐掉（无回放可让位时允许短暂超额）", () => {
    const budget = createVoiceBudget(4);
    budget.admitProtected(
      group({ trackId: "live-a", klass: "held" }),
      0,
    );
    const second = budget.admitProtected(
      group({ trackId: "live-b", klass: "held" }),
      0,
    );
    expect(second.accepted).toBe(true);
    const report = budget.report(0);
    expect(report.held).toBe(6);
    expect(report.used).toBe(6);
    expect(report.limited).toHaveLength(0);
  });

  it("现场声音进场时优先淘汰低优先级回放", () => {
    const budget = createVoiceBudget(6);
    budget.admitPlayback(group({ trackId: "low", priority: 1 }), 0);
    budget.admitPlayback(group({ trackId: "mid", priority: 8 }), 0);
    const live = budget.admitProtected(
      group({ trackId: "live", klass: "held", priority: 1 }),
      0,
    );
    expect(live.accepted).toBe(true);
    expect(live.evictedVoiceIds).toHaveLength(3);
    const report = budget.report(0);
    expect(report.held).toBe(3);
    expect(report.active.mid).toBe(3);
    expect(report.active.low).toBeUndefined();
  });

  it("正在录音的声部同样不可淘汰", () => {
    const budget = createVoiceBudget(3);
    budget.admitProtected(
      group({ trackId: "rec", klass: "recording" }),
      0,
    );
    const playback = budget.admitPlayback(group({ trackId: "playback" }), 0);
    expect(playback.accepted).toBe(false);
    expect(budget.report(0).recording).toBe(3);
  });

  it("预排的未来声音不会挤掉当前和弦", () => {
    const budget = createVoiceBudget(6);
    budget.admitPlayback(
      group({ trackId: "now", start: 0, end: 2, priority: 9 }),
      0,
    );
    const later = group({
      trackId: "later",
      start: 10,
      end: 12,
      priority: 1,
      voices: [voice("x1", 10, 12), voice("x2", 10, 12), voice("x3", 10, 12)],
    });
    expect(budget.admitPlayback(later, 0).accepted).toBe(true);
    expect(budget.report(0).active.now).toBe(3);
  });

  it("同优先级时靠后的轨道让位，前面的轨道保留", () => {
    const budget = createVoiceBudget(3);
    // 靠后的轨道先占位，靠前的轨道到场时可以夺走名额。
    budget.admitPlayback(group({ trackId: "back", order: 7, priority: 5 }), 0);
    const admission = budget.admitPlayback(
      group({ trackId: "front", order: 0, priority: 5 }),
      0,
    );
    expect(admission.accepted).toBe(true);
    expect(admission.evictedVoiceIds).toHaveLength(3);
    expect(budget.report(0).active).toEqual({ front: 3 });
    expect(budget.report(0).limited).toEqual([
      { trackId: "back", droppedVoices: 3, reason: "evicted" },
    ]);
  });

  it("同一条轨道的新声部可以接替自己的旧声部，不互相叠加", () => {
    const budget = createVoiceBudget(3);
    budget.admitPlayback(group({ trackId: "lead", start: 0, end: 1 }), 0);
    const next = budget.admitPlayback(
      group({ trackId: "lead", start: 0.5, end: 1.5 }),
      0,
    );
    expect(next.accepted).toBe(true);
    expect(next.evictedVoiceIds).toHaveLength(3);
    expect(budget.report(0).active).toEqual({ lead: 3 });
  });

  it("停轨立即归还声部与受限提示", () => {
    const budget = createVoiceBudget(3);
    budget.admitPlayback(group({ trackId: "a", order: 0 }), 0);
    budget.admitPlayback(group({ trackId: "b", order: 1 }), 0);
    const released = budget.stopTrack("a");
    expect(released).toHaveLength(3);
    expect(budget.report(0).active.a).toBeUndefined();
    expect(budget.report(0).limited.some((x) => x.trackId === "a")).toBe(false);
    // 归还后名额可以复用。
    expect(
      budget.admitPlayback(group({ trackId: "c", order: 2 }), 0).accepted,
    ).toBe(true);
  });

  it("自然结束后名额归还，反复进出不累积", () => {
    const budget = createVoiceBudget(3);
    for (let i = 0; i < 50; i++) {
      const start = i;
      expect(
        budget.admitPlayback(group({ trackId: "loop", start, end: start + 0.5 }), start)
          .accepted,
      ).toBe(true);
      budget.prune(start + 0.6);
    }
    expect(budget.report(100).playback).toBe(0);
    expect(budget.report(100).used).toBe(0);
  });

  it("clear 返回全部声部并清空账目", () => {
    const budget = createVoiceBudget(64);
    budget.admitPlayback(group({ trackId: "a" }), 0);
    budget.admitProtected(group({ trackId: "b", klass: "held" }), 0);
    expect(budget.clear()).toHaveLength(6);
    expect(budget.report(0).used).toBe(0);
  });
});
