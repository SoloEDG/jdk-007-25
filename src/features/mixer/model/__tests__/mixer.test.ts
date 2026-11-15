import { describe, expect, it } from "vitest";
import { installFakeAudio } from "@/features/instruments/lib/__tests__/fakeAudio";
import { createMixer } from "../mixer";

describe("混音总线按真实轨道 id", () => {
  it("推子改变的是对应轨道的总线增益", async () => {
    const context = installFakeAudio();
    const mixer = createMixer();
    mixer.attach(context as unknown as AudioContext);
    mixer.ensure(["a", "b", "c"]);
    const a = mixer.channel("a") as unknown as { gain: { value: number } };
    mixer.volume("a", 0.3);
    expect(a.gain.value).toBeCloseTo(0.3);
    // 其它轨道不受影响。
    expect(
      (mixer.channel("b") as unknown as { gain: { value: number } }).gain.value,
    ).toBeCloseTo(0.75);
  });

  it("静音把总线增益归零，取消静音恢复", () => {
    const context = installFakeAudio();
    const mixer = createMixer();
    mixer.attach(context as unknown as AudioContext);
    mixer.ensure(["a"]);
    const a = mixer.channel("a") as unknown as { gain: { value: number } };
    expect(mixer.mute("a")).toBe(true);
    expect(a.gain.value).toBe(0);
    expect(mixer.mute("a")).toBe(false);
    expect(a.gain.value).toBeCloseTo(0.75);
  });

  it("删轨后对应总线断开并被移除，重新添加同 id 会重建", () => {
    const context = installFakeAudio();
    const mixer = createMixer();
    mixer.attach(context as unknown as AudioContext);
    mixer.ensure(["a", "b"]);
    mixer.ensure(["a"]);
    expect(mixer.snapshot().channels.b).toBeUndefined();
    expect(() => mixer.channel("b")).toThrow();
    mixer.ensure(["a", "b"]);
    expect(mixer.channel("b")).toBeTruthy();
  });

  it("反复同步不会累积总线节点", () => {
    const context = installFakeAudio();
    const mixer = createMixer();
    mixer.attach(context as unknown as AudioContext);
    const ids = Array.from({ length: 64 }, (_, i) => `t${i}`);
    for (let round = 0; round < 50; round++) mixer.ensure(ids);
    expect(context.live.size).toBe(64 + 1); // 64 条通道 + 主输出
    mixer.dispose();
    expect(context.connectedNodes()).toBe(0);
  });
});
