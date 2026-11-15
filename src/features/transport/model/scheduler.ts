import type { ScheduledNote, Track } from "@/shared/types";
import { DEFAULT_PRIORITY } from "@/shared/constants";

export type PlaybackTrack = Track & { order?: number; priority?: number };

/**
 * 把落在 [from, to) 的播放窗口编译成「原子声部组」：
 * 同一条轨道、同一时刻触发的全部音符是一组（一个和弦绝不被拆开）。
 * 分组发生在预算之前，因此预算只能整组接受或整组拒绝。
 *
 * 这是一次性的简单实现，适合小作品与测试；工作室热路径使用
 * createPlaybackIndex 的二分查找版本。
 */
export function collectGroups(
  tracks: readonly PlaybackTrack[],
  from: number,
  to: number,
  beats: number,
  bpm: number,
  timeAt: (beat: number) => number,
): import("@/shared/types").ScheduledGroup[] {
  const groups = new Map<string, import("@/shared/types").ScheduledGroup>();
  const secondsPerBeat = 60 / bpm;
  for (let order = 0; order < tracks.length; order++) {
    const track = tracks[order];
    const priority = track.priority ?? DEFAULT_PRIORITY;
    for (const note of track.notes) {
      let at =
        note.beat + Math.max(0, Math.ceil((from - note.beat) / beats)) * beats;
      while (at < to) {
        if (at >= from) {
          const when = timeAt(at);
          const key = `${track.id}\u0000${at}`;
          let group = groups.get(key);
          if (!group) {
            group = { trackId: track.id, when, priority, order, notes: [] };
            groups.set(key, group);
          }
          const scheduled: ScheduledNote = {
            trackId: track.id,
            instrument: track.instrument,
            pitch: note.pitch,
            velocity: note.velocity,
            duration: note.duration * secondsPerBeat,
            when,
            priority,
            order,
          };
          group.notes.push(scheduled);
        }
        at += beats;
      }
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.when - b.when || a.order - b.order || a.trackId.localeCompare(b.trackId),
  );
}

/** 兼容旧调用方式：按组展开成单个音符回调。预算应在外层完成。 */
export function scheduleWindow(
  tracks: readonly PlaybackTrack[],
  from: number,
  to: number,
  beats: number,
  bpm: number,
  timeAt: (beat: number) => number,
  play: (note: ScheduledNote) => void,
) {
  for (const group of collectGroups(tracks, from, to, beats, bpm, timeAt))
    for (const note of group.notes) play(note);
}
