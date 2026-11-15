import type { Session, Track, Note } from "@/shared/types";
import {
  MAX_TRACKS,
  MAX_NOTES_PER_TRACK,
  DEFAULT_PRIORITY,
} from "@/shared/constants";

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;

/**
 * 校验并归一化存档。旧版本（8 轨上限、无声部优先级）仍然接受：
 * 缺失的 priority 补默认值，听感与原作品保持一致。
 * 声部预算不参与校验——超出预算的大作品必须完整保存全部音符。
 */
export function validateSession(raw: unknown): Session {
  if (
    !object(raw) ||
    raw.version !== 1 ||
    typeof raw.title !== "string" ||
    raw.title.length > 80 ||
    !finite(raw.bpm, 40, 220) ||
    ![4, 8, 16, 32].includes(raw.beats as number) ||
    !Array.isArray(raw.tracks) ||
    raw.tracks.length > MAX_TRACKS ||
    !object(raw.channels) ||
    !finite(raw.master, 0, 1)
  )
    throw new Error("存档格式或版本不受支持");
  const ids = new Set<string>();
  const noteIds = new Set<string>();
  const tracks: Track[] = [];
  for (const value of raw.tracks) {
    if (!object(value)) throw new Error("轨道损坏");
    const t = value as unknown as Track;
    if (
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      !t.id ||
      typeof t.name !== "string" ||
      t.name.length > 32 ||
      !["drums", "keys"].includes(t.instrument) ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !Array.isArray(t.notes) ||
      t.notes.length > MAX_NOTES_PER_TRACK
    )
      throw new Error("轨道数据无效");
    ids.add(t.id);
    const notes: Note[] = [];
    for (const n of t.notes as Note[]) {
      if (
        !object(n) ||
        typeof n.id !== "string" ||
        noteIds.has(n.id) ||
        !finite(
          n.pitch,
          t.instrument === "drums" ? 0 : 24,
          t.instrument === "drums" ? 3 : 108,
        ) ||
        !Number.isInteger(n.pitch) ||
        !finite(n.beat, 0, (raw.beats as number) - 0.000001) ||
        !finite(n.duration, 0.01, raw.beats as number) ||
        !finite(n.velocity, 0.01, 1)
      )
        throw new Error("音符数据无效");
      noteIds.add(n.id);
      notes.push(n);
    }
    const c = raw.channels[t.id];
    if (!object(c) || !finite(c.volume, 0, 1) || typeof c.muted !== "boolean")
      throw new Error("混音数据无效");
    const priority =
      typeof t.priority === "number" &&
      Number.isInteger(t.priority) &&
      t.priority >= 1 &&
      t.priority <= 9
        ? t.priority
        : DEFAULT_PRIORITY;
    tracks.push({
      ...t,
      priority,
      notes,
    });
  }
  // 每条轨道都必须有混音通道状态；多余通道（已删除的轨道）丢弃。
  const source = raw.channels;
  const channels = Object.fromEntries(
    tracks.map((track) => {
      const channel = source[track.id] as { volume: number; muted: boolean };
      return [track.id, { volume: channel.volume, muted: channel.muted }];
    }),
  );
  return {
    version: 1,
    title: raw.title,
    bpm: raw.bpm,
    beats: raw.beats,
    tracks,
    channels,
    master: raw.master,
  } as Session;
}
