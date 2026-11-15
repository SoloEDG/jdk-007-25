import { describe, expect, it } from "vitest";
import { createPlaybackIndex } from "../../model/playbackIndex";
import { collectGroups } from "../../model/scheduler";
import type { Track } from "@/shared/types";

const track = (
  id: string,
  notes: { pitch: number; beat: number; duration?: number }[],
  priority = 5,
): Track => ({
  id,
  name: id,
  instrument: "keys",
  color: "#d5f377",
  priority,
  notes: notes.map((n, i) => ({
    id: `${id}-${i}`,
    pitch: n.pitch,
    beat: n.beat,
    duration: n.duration ?? 1,
    velocity: 0.6,
  })),
});

const timeAt = (beat: number) => beat * 0.5;

describe("回放索引", () => {
  it("同一时刻同一轨道的全部音符合并为一个原子组", () => {
    const index = createPlaybackIndex([
      track("chord", [
        { pitch: 60, beat: 0 },
        { pitch: 64, beat: 0 },
        { pitch: 67, beat: 0 },
      ]),
    ]);
    const groups = index.query(0, 1, 16, 120, timeAt);
    expect(groups).toHaveLength(1);
    expect(groups[0].notes).toHaveLength(3);
    expect(groups[0].trackId).toBe("chord");
  });

  it("不同轨道的同一瞬间是不同组，可独立裁决", () => {
    const index = createPlaybackIndex([
      track("a", [{ pitch: 60, beat: 0 }]),
      track("b", [{ pitch: 62, beat: 0 }]),
    ]);
    const groups = index.query(0, 0.5, 16, 120, timeAt);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.trackId).sort()).toEqual(["a", "b"]);
  });

  it("窗口跨越循环边界时两次出现都排入", () => {
    const index = createPlaybackIndex([
      track("loop", [{ pitch: 60, beat: 0 }]),
    ]);
    // 从 15.5 排到 16.5：0 拍在 16 处再次出现。
    const groups = index.query(15.5, 16.5, 16, 120, timeAt);
    expect(groups.map((g) => g.when)).toEqual([timeAt(16)]);
    const span = index.query(0, 16, 16, 120, timeAt);
    expect(span).toHaveLength(1);
  });

  it("静音轨道不进入调度但音符仍留在索引外只影响查询", () => {
    const index = createPlaybackIndex([
      track("a", [{ pitch: 60, beat: 0 }]),
      track("b", [{ pitch: 62, beat: 0 }]),
    ]);
    const groups = index.query(0, 1, 16, 120, timeAt, new Set(["a"]));
    expect(groups).toHaveLength(1);
    expect(groups[0].trackId).toBe("b");
  });

  it("64 轨同时齐奏时为每条轨道各产生一组，顺序稳定", () => {
    const tracks = Array.from({ length: 64 }, (_, i) =>
      track(`t${i}`, [{ pitch: 48 + i, beat: 0 }]),
    );
    const index = createPlaybackIndex(tracks);
    const groups = index.query(0, 1, 16, 120, timeAt);
    expect(groups).toHaveLength(64);
    expect(groups.map((g) => g.order)).toEqual(
      Array.from({ length: 64 }, (_, i) => i),
    );
  });

  it("collectGroups 与索引对同窗口给出一致的分组", () => {
    const tracks = [
      track("a", [{ pitch: 60, beat: 0 }, { pitch: 64, beat: 4 }]),
      track("b", [{ pitch: 62, beat: 2 }]),
    ];
    const from = collectGroups(tracks, 0, 1, 16, 120, timeAt);
    const indexed = createPlaybackIndex(
      tracks.map((t, order) => ({ ...t, order })),
    ).query(0, 1, 16, 120, timeAt);
    expect(indexed.map((g) => [g.trackId, g.notes.length])).toEqual(
      from.map((g) => [g.trackId, g.notes.length]),
    );
  });

  it("短时间内反复查询窗口不会累积任何内容", () => {
    const index = createPlaybackIndex([
      track("a", [{ pitch: 60, beat: 0 }]),
    ]);
    for (let i = 0; i < 1000; i++) index.query(15.9, 16.1, 16, 120, timeAt);
    const groups = index.query(15.9, 16.1, 16, 120, timeAt);
    expect(groups).toHaveLength(1);
    expect(groups[0].when).toBe(timeAt(16));
    expect(index.size).toBe(1);
  });
});
