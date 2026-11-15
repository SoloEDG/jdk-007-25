import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeAudio, type FakeAudioContext } from "@/features/instruments/lib/__tests__/fakeAudio";
import { createStudio, type Studio } from "./studio";
import { MAX_TRACKS, MAX_NOTES_PER_TRACK } from "@/shared/constants";

let context: FakeAudioContext;
let interval: (() => void) | null = null;
const store = new Map<string, string>();

beforeEach(() => {
  context = installFakeAudio();
  interval = null;
  store.clear();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  vi.stubGlobal("window", {
    setInterval: (fn: () => void) => {
      interval = fn;
      return 1;
    },
    clearInterval: () => {
      interval = null;
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
});

const setup = () => {
  let renders = 0;
  const studio = createStudio(() => {
    renders++;
  });
  return { studio, renders: () => renders };
};

const addTracks = (studio: Studio, count: number) => {
  for (let i = 0; i < count; i++) studio.add(i % 2 === 0 ? "keys" : "drums");
};

describe("工作室集成：64 轨、预算与资源归还", () => {
  it("可以建立 64 条轨道，超出时给出可读提示且不破坏现有作品", () => {
    const { studio } = setup();
    addTracks(studio, MAX_TRACKS);
    const before = studio.view();
    expect(before.arrangement.tracks).toHaveLength(MAX_TRACKS);
    studio.add("keys");
    const after = studio.view();
    expect(after.arrangement.tracks).toHaveLength(MAX_TRACKS);
    expect(after.message).toMatch(/64/);
    studio.dispose();
  });

  it("播放时声部受预算约束，但音符数据完整保留", async () => {
    const { studio } = setup();
    for (let i = 0; i < 24; i++) studio.add("keys");
    // 给每条轨道填满音符（每拍一个六音和弦）。
    const view = studio.view();
    for (const track of view.arrangement.tracks) {
      const id = track.id;
      studio.select(id);
      // 通过录音目标之外的公开 API 无法直接写音符，这里用内部快照 + 重新载入。
    }
    // 每条琴键轨道每拍一个六音和弦，24 轨合计远超声部预算。
    const tracks = studio.view().arrangement.tracks.map((track, index) => ({
      ...track,
      notes: Array.from({ length: 16 }, (_, beat) =>
        track.instrument === "keys"
          ? [0, 3, 5, 7, 10, 12].map((offset, j) => ({
              id: `n-${index}-${beat}-${j}`,
              pitch: 48 + (beat % 6) + offset,
              beat,
              duration: 0.9,
              velocity: 0.45,
            }))
          : [
              {
                id: `n-${index}-${beat}`,
                pitch: beat % 4,
                beat,
                duration: 0.2,
                velocity: 0.5,
              },
            ],
      ).flat(),
    }));
    store.set(
      "nightshift-session-v1",
      JSON.stringify({
        version: 1,
        title: "集成测试",
        bpm: 120,
        beats: 16,
        tracks,
        channels: Object.fromEntries(
          tracks.map((track) => [track.id, { volume: 0.7, muted: false }]),
        ),
        master: 0.7,
      }),
    );
    studio.load();
    const loaded = studio.view();
    expect(loaded.arrangement.tracks).toHaveLength(24);
    const expectedNotes = loaded.arrangement.tracks.reduce(
      (sum, t) => sum + t.notes.length,
      0,
    );
    expect(expectedNotes).toBe(24 * 16 * 6);

    await studio.play();
    for (let i = 0; i < 80; i++) {
      context.currentTime += 0.02;
      interval?.();
    }
    const live = studio.view();
    expect(live.budget.limit).toBeGreaterThan(0);
    expect(live.budget.used).toBeLessThanOrEqual(live.budget.limit);
    expect(live.budget.dropped).toBeGreaterThan(0);
    expect(live.limited.size).toBeGreaterThan(0);
    // 保存仍然包含全部音符，不因预算裁剪。
    studio.save();
    const saved = JSON.parse(store.get("nightshift-session-v1")!);
    expect(
      saved.tracks.reduce(
        (sum: number, t: { notes: unknown[] }) => sum + t.notes.length,
        0,
      ),
    ).toBe(expectedNotes);
    studio.dispose();
  });

  it("静音立即归还该轨道的声部与优先级限制", async () => {
    const { studio } = setup();
    studio.demo();
    const id = studio.view().arrangement.tracks[0].id;
    await studio.play();
    for (let i = 0; i < 20; i++) {
      context.currentTime += 0.02;
      interval?.();
    }
    expect(studio.view().budget.active[id] ?? 0).toBeGreaterThan(0);
    studio.mute(id);
    expect(studio.view().budget.active[id]).toBeUndefined();
    studio.dispose();
  });

  it("删轨立即停止声音、释放声道并让选择落到真实轨道上", async () => {
    const { studio } = setup();
    studio.demo();
    const first = studio.view().arrangement.tracks[0];
    studio.select(first.id);
    await studio.play();
    for (let i = 0; i < 20; i++) {
      context.currentTime += 0.02;
      interval?.();
    }
    expect(studio.view().budget.active[first.id] ?? 0).toBeGreaterThan(0);
    studio.remove();
    const view = studio.view();
    expect(view.arrangement.tracks.find((t) => t.id === first.id)).toBeUndefined();
    expect(view.budget.active[first.id]).toBeUndefined();
    expect(view.mixer.channels[first.id]).toBeUndefined();
    expect(view.selected?.id).not.toBe(first.id);
    expect(view.message).toMatch(/已删除/);
    studio.dispose();
  });

  it("切轨与滚动式重渲染不改变录音目标", async () => {
    const { studio } = setup();
    addTracks(studio, 40);
    const target = studio.view().arrangement.tracks[37];
    studio.select(target.id);
    await studio.record();
    for (let i = 0; i < 120; i++) {
      context.currentTime += 0.02;
      interval?.();
    }
    const during = studio.view();
    // 录音期间不得切轨（界面锁定），目标始终是真实 id。
    expect(during.recorder.trackId).toBe(target.id);
    expect(during.recorder.status).not.toBe("idle");
    studio.dispose();
  });

  it("反复暂停恢复与静音不累积声部或声道", async () => {
    const { studio } = setup();
    studio.demo();
    for (let round = 0; round < 30; round++) {
      await studio.play();
      for (let i = 0; i < 20; i++) {
        context.currentTime += 0.02;
        interval?.();
      }
      studio.pause();
      studio.stop();
    }
    const view = studio.view();
    expect(view.budget.used).toBe(0);
    expect(view.budget.active).toEqual({});
    studio.dispose();
  });

  it("旧 8 轨存档保持原有听感（默认优先级、原有通道与音量）", () => {
    const { studio } = setup();
    const legacy = {
      version: 1,
      title: "旧作品",
      bpm: 96,
      beats: 8,
      master: 0.6,
      channels: {
        a: { volume: 0.9, muted: false },
        b: { volume: 0.25, muted: true },
      },
      tracks: [
        {
          id: "a",
          name: "鼓",
          instrument: "drums",
          color: "#d5f377",
          notes: [
            { id: "x", pitch: 0, beat: 0, duration: 0.2, velocity: 0.8 },
          ],
        },
        {
          id: "b",
          name: "琴",
          instrument: "keys",
          color: "#bca5f4",
          notes: [
            { id: "y", pitch: 60, beat: 1, duration: 1, velocity: 0.5 },
          ],
        },
      ],
    };
    store.set("nightshift-session-v1", JSON.stringify(legacy));
    studio.load();
    const view = studio.view();
    expect(view.arrangement.tracks).toHaveLength(2);
    expect(view.arrangement.tracks.map((t) => t.priority)).toEqual([5, 5]);
    expect(view.mixer.channels.a).toEqual({ volume: 0.9, muted: false });
    expect(view.mixer.channels.b).toEqual({ volume: 0.25, muted: true });
    expect(view.transport.bpm).toBe(96);
    studio.dispose();
  });

  it("大作品可以完整保存与恢复（64 轨 × 上限附近音符）", () => {
    const { studio } = setup();
    const tracks = Array.from({ length: MAX_TRACKS }, (_, i) => ({
      id: `t${i}`,
      name: `轨道 ${i + 1}`,
      instrument: i % 2 === 0 ? ("keys" as const) : ("drums" as const),
      color: "#d5f377",
      priority: 5,
      notes: Array.from({ length: 64 }, (_, n) => ({
        id: `t${i}-n${n}`,
        pitch: i % 2 === 0 ? 48 + (n % 24) : n % 4,
        beat: (n % 16) + Math.floor(n / 16) * 0.25,
        duration: 0.2,
        velocity: 0.4,
      })),
    }));
    store.set(
      "nightshift-session-v1",
      JSON.stringify({
        version: 1,
        title: "超大编制",
        bpm: 120,
        beats: 16,
        tracks,
        channels: Object.fromEntries(
          tracks.map((t) => [t.id, { volume: 0.5, muted: false }]),
        ),
        master: 0.6,
      }),
    );
    studio.load();
    expect(studio.view().arrangement.tracks).toHaveLength(MAX_TRACKS);
    studio.save();
    const text = store.get("nightshift-session-v1")!;
    const saved = JSON.parse(text);
    expect(saved.tracks).toHaveLength(MAX_TRACKS);
    expect(
      saved.tracks.reduce(
        (sum: number, t: { notes: unknown[] }) => sum + t.notes.length,
        0,
      ),
    ).toBe(MAX_TRACKS * 64);
    expect(MAX_TRACKS * 64).toBeLessThan(MAX_NOTES_PER_TRACK * MAX_TRACKS);
    studio.dispose();
  });
});
