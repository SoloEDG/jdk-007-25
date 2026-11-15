import { describe, expect, it } from "vitest";
import { createRecorder } from "../recorder";

const note = { pitch: 60, velocity: 0.7, instrument: "keys" as const };

describe("录音目标不随可见行漂移", () => {
  it("arm 后目标固定为轨道 id，即使轨道被重排 / 视口滚动", () => {
    const recorder = createRecorder();
    recorder.arm("track-37", "keys", 0, 16);
    expect(recorder.target()).toBe("track-37");
    // 界面滚动、选择其它行都不会调用 arm；target 始终是 id。
    expect(recorder.snapshot().trackId).toBe("track-37");
  });

  it("录制完成后返回绑定的真实轨道 id 与全部音符", () => {
    const recorder = createRecorder();
    // 从下一个循环起点开始（captureBoundary(0, 4) === 4）。
    recorder.arm("track-9", "keys", 0, 4);
    recorder.advance(4);
    recorder.down("piano:60", note, 4.5);
    recorder.up("piano:60", 5);
    const take = recorder.advance(8);
    expect(take?.trackId).toBe("track-9");
    expect(take?.notes).toHaveLength(1);
    expect(recorder.target()).toBeNull();
  });

  it("录音中的声部类别是 recording", () => {
    const recorder = createRecorder();
    expect(recorder.voiceClass()).toBe("held");
    recorder.arm("t", "keys", 0, 4);
    expect(recorder.voiceClass()).toBe("recording");
    recorder.cancel();
    expect(recorder.voiceClass()).toBe("held");
  });

  it("录音目标被删后可以显式放弃，不会写到别的轨道", () => {
    const recorder = createRecorder();
    recorder.arm("t", "keys", 0, 4);
    recorder.advance(4);
    recorder.down("piano:60", note, 4.2);
    recorder.cancel();
    expect(recorder.advance(9)).toBeNull();
    expect(recorder.target()).toBeNull();
  });

  it("音符数量受上限保护但不会破坏已录部分", () => {
    const recorder = createRecorder();
    recorder.arm("t", "keys", 0, 16);
    recorder.advance(16);
    for (let i = 0; i < 2100; i++)
      recorder.down(`piano:${i}`, { ...note, pitch: 60 + (i % 12) }, 16 + (i % 16));
    for (let i = 0; i < 2100; i++)
      recorder.up(`piano:${i}`, 16 + (i % 16) + 0.25);
    const take = recorder.advance(32);
    expect(take!.notes.length).toBeLessThanOrEqual(2048);
    expect(take!.notes.length).toBeGreaterThan(0);
  });
});
