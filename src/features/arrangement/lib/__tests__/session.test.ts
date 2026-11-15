import { describe, expect, it } from "vitest";
import { validateSession } from "../validation";
import { demoSession, largeDemoSession } from "../demo";
import { createArrangement } from "../../model/arrangement";
import { MAX_TRACKS } from "@/shared/constants";

const channel = { volume: 0.75, muted: false };

describe("64 轨编排与存档", () => {
  it("最多可添加 64 条轨道，第 65 条被明确拒绝", () => {
    const arrangement = createArrangement();
    for (let i = 0; i < MAX_TRACKS; i++)
      arrangement.add(i % 2 === 0 ? "keys" : "drums");
    expect(arrangement.snapshot().tracks).toHaveLength(MAX_TRACKS);
    expect(() => arrangement.add("keys")).toThrow(/64/);
  });

  it("每条轨道颜色有效且带默认声部优先级", () => {
    const arrangement = createArrangement();
    for (let i = 0; i < MAX_TRACKS; i++) arrangement.add("keys");
    for (const track of arrangement.snapshot().tracks) {
      expect(track.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(track.priority).toBe(5);
    }
  });

  it("旧版 8 轨存档仍可载入，缺失优先级补默认值", () => {
    const legacy = demoSession();
    const legacyTracks = legacy.tracks.map(({ priority, ...rest }) => rest);
    const session = validateSession({
      ...legacy,
      tracks: legacyTracks,
    });
    expect(session.tracks).toHaveLength(3);
    for (const track of session.tracks) expect(track.priority).toBe(5);
  });

  it("64 轨大作品完整保存全部音符，不被声部预算裁剪", () => {
    const arrangement = createArrangement();
    for (let i = 0; i < MAX_TRACKS; i++) {
      const id = arrangement.add("keys");
      arrangement.commit(
        id,
        Array.from({ length: 16 }, (_, n) => ({
          id: `note-${i}-${n}`,
          pitch: 60 + (n % 12),
          beat: n,
          duration: 0.5,
          velocity: 0.5,
        })),
      );
    }
    const snapshot = arrangement.snapshot();
    const session = validateSession({
      version: 1,
      title: "大编制",
      bpm: 120,
      beats: 16,
      tracks: snapshot.tracks,
      channels: Object.fromEntries(
        snapshot.tracks.map((track) => [track.id, channel]),
      ),
      master: 0.7,
    });
    expect(session.tracks).toHaveLength(64);
    expect(session.tracks.flatMap((t) => t.notes)).toHaveLength(64 * 16);
  });

  it("超出 64 轨的存档被拒绝", () => {
    const large = largeDemoSession(64);
    const extra = {
      ...large.tracks[0],
      id: "extra",
      name: "多余",
      notes: [],
    };
    expect(() =>
      validateSession({
        ...large,
        tracks: [...large.tracks, extra],
        channels: { ...large.channels, extra: channel },
      }),
    ).toThrow(/存档/);
  });

  it("每条轨道都必须有混音通道，多余通道被丢弃", () => {
    const base = demoSession();
    const session = validateSession({
      ...base,
      channels: { ...base.channels, ghost: channel },
    });
    expect(Object.keys(session.channels).sort()).toEqual(
      base.tracks.map((t) => t.id).sort(),
    );
  });

  it("删除轨道后选择落到真实剩余轨道上", () => {
    const arrangement = createArrangement();
    const a = arrangement.add("keys");
    const b = arrangement.add("drums");
    arrangement.select(a);
    arrangement.remove(a);
    const snapshot = arrangement.snapshot();
    expect(snapshot.selected).toBe(b);
  });
});
