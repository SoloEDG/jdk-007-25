import type { ScheduledGroup, ScheduledNote, Track } from "@/shared/types";
import { DEFAULT_PRIORITY } from "@/shared/constants";

export type IndexedTrack = Omit<Track, "notes"> & {
  order?: number;
  priority?: number;
  notes: readonly {
    pitch: number;
    beat: number;
    duration: number;
    velocity: number;
  }[];
};

type Entry = {
  beat: number;
  trackId: string;
  order: number;
  priority: number;
  instrument: ScheduledNote["instrument"];
  pitch: number;
  velocity: number;
  duration: number;
};

/**
 * 回放索引：按音符起点排序一次，之后每个调度窗口只做二分查找。
 * 这样即使有 64 条轨道、上万音符，每个 tick 也只触碰真正要发声的音符，
 * 且与界面当前滚到哪里、哪条轨道可见完全无关。
 */
export function createPlaybackIndex(tracks: readonly IndexedTrack[]) {
  const entries: Entry[] = [];
  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index];
    const order = track.order ?? index;
    const priority = track.priority ?? DEFAULT_PRIORITY;
    for (const note of track.notes)
      entries.push({
        beat: note.beat,
        trackId: track.id,
        order,
        priority,
        instrument: track.instrument,
        pitch: note.pitch,
        velocity: note.velocity,
        duration: note.duration,
      });
  }
  entries.sort(
    (a, b) =>
      a.beat - b.beat ||
      a.order - b.order ||
      a.pitch - b.pitch ||
      a.trackId.localeCompare(b.trackId),
  );

  const lowerBound = (value: number) => {
    let lo = 0,
      hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].beat < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  return {
    size: entries.length,
    /**
     * 返回窗口内的原子声部组。同一条轨道在同一时刻触发的全部音符
     * 会先合并成一个组，再由声部预算整组裁决。
     */
    query(
      from: number,
      to: number,
      beats: number,
      bpm: number,
      timeAt: (beat: number) => number,
      muted: ReadonlySet<string> = new Set(),
    ): ScheduledGroup[] {
      if (!(to > from) || beats <= 0) return [];
      const secondsPerBeat = 60 / bpm;
      const span = to - from;
      const base = Math.floor(from / beats) * beats;
      const localFrom = from - base;
      const groups = new Map<string, ScheduledGroup>();
      const copies = Math.floor((localFrom + span - 1e-9) / beats) + 1;
      for (let copy = 0; copy < copies; copy++) {
        const start = copy === 0 ? localFrom : 0;
        const end = Math.min(beats, localFrom + span - copy * beats);
        if (end <= start) continue;
        const shift = base + copy * beats;
        for (let i = lowerBound(start); i < entries.length; i++) {
          const entry = entries[i];
          if (entry.beat >= end) break;
          if (muted.has(entry.trackId)) continue;
          const occurrence = entry.beat + shift;
          const when = timeAt(occurrence);
          const key = `${entry.trackId}\u0000${occurrence}`;
          let group = groups.get(key);
          if (!group) {
            group = {
              trackId: entry.trackId,
              when,
              priority: entry.priority,
              order: entry.order,
              notes: [],
            };
            groups.set(key, group);
          }
          group.notes.push({
            trackId: entry.trackId,
            instrument: entry.instrument,
            pitch: entry.pitch,
            velocity: entry.velocity,
            duration: entry.duration * secondsPerBeat,
            when,
            priority: entry.priority,
            order: entry.order,
          });
        }
      }
      return [...groups.values()].sort(
        (a, b) =>
          a.when - b.when ||
          a.order - b.order ||
          a.trackId.localeCompare(b.trackId),
      );
    },
  };
}
export type PlaybackIndex = ReturnType<typeof createPlaybackIndex>;
