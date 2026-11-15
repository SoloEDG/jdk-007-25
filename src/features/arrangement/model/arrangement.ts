import type { Track, Instrument, Note, Session } from "@/shared/types";
import { uid } from "@/shared/math";
import { MAX_TRACKS, DEFAULT_PRIORITY } from "@/shared/constants";
import { validateSession } from "../lib/validation";

const palette = [
  "#d5f377",
  "#bca5f4",
  "#8fbfff",
  "#f4af84",
  "#80cfbb",
  "#ed94b4",
  "#cec080",
  "#a6b6c9",
  "#e4c96f",
  "#93d7e8",
  "#d9a6f0",
  "#9fdf9f",
  "#e8a0a0",
  "#b0b8e8",
  "#e0cf9a",
  "#8fc9b0",
];
const colorAt = (index: number) => palette[index % palette.length];

export function createArrangement() {
  let tracks: Track[] = [],
    selected: string | null = null,
    title = "未命名夜航",
    revision = 0;
  const find = (id: string | null) =>
    id ? (tracks.find((track) => track.id === id) ?? null) : null;
  const touched = () => {
    revision++;
  };
  return {
    /**
     * 只读快照。轨道数组按不可变方式替换，因此直接共享引用是安全的，
     * 也避免每次界面刷新都深拷贝数万个音符。
     */
    snapshot() {
      return { tracks, selected, title };
    },
    revision() {
      return revision;
    },
    title() {
      return title;
    },
    /** 返回不可变轨道引用（轨道整体替换，不在原地改），避免每次刷新深拷贝。 */
    selected() {
      return find(selected);
    },
    /** 按真实轨道 id 选择；可见行区间与选择状态完全解耦。 */
    select(id: string) {
      // 只改变选择，不改变作品内容：不使回放索引失效，也就不会在切轨时
      // 重建索引或触碰任何音频节点。
      if (tracks.some((track) => track.id === id)) selected = id;
    },
    indexOf(id: string | null) {
      return id ? tracks.findIndex((track) => track.id === id) : -1;
    },
    add(instrument: Instrument) {
      if (tracks.length >= MAX_TRACKS)
        throw new Error(`最多支持 ${MAX_TRACKS} 条轨道，请先移除一条`);
      const ordinal =
        tracks.filter((track) => track.instrument === instrument).length + 1;
      const track: Track = {
        id: uid(),
        name: `${instrument === "drums" ? "鼓组" : "琴键"} ${ordinal}`,
        instrument,
        color: colorAt(tracks.length),
        priority: DEFAULT_PRIORITY,
        notes: [],
      };
      tracks = [...tracks, track];
      selected = track.id;
      touched();
      return track.id;
    },
    remove(id: string) {
      const removed = find(id);
      if (!removed) return null;
      tracks = tracks.filter((track) => track.id !== id);
      if (selected === id) selected = tracks[0]?.id ?? null;
      touched();
      return removed;
    },
    commit(id: string, notes: Note[]) {
      if (!tracks.some((track) => track.id === id))
        throw new Error("录音目标已不存在");
      // 保存与提交都不受声部预算影响：音符永远完整保留。
      tracks = tracks.map((track) =>
        track.id === id ? { ...track, notes: structuredClone(notes) } : track,
      );
      touched();
    },
    resizeLoop(beats: number) {
      tracks = tracks.map((track) => ({
        ...track,
        notes: track.notes
          .filter((note) => note.beat < beats)
          .map((note) => ({
            ...note,
            duration: Math.min(note.duration, beats - note.beat),
          })),
      }));
      touched();
    },
    clear(id: string) {
      this.commit(id, []);
    },
    setPriority(id: string, priority: number) {
      if (!Number.isInteger(priority) || priority < 1 || priority > 9) return;
      tracks = tracks.map((track) =>
        track.id === id ? { ...track, priority } : track,
      );
      touched();
    },
    restore(raw: Session) {
      const session = validateSession(raw);
      tracks = session.tracks;
      title = session.title;
      selected = tracks[0]?.id ?? null;
      revision++;
      return session;
    },
    /** 传给调度器的只读视图，与界面可见与否无关。 */
    playbackTracks() {
      return tracks.map((track, index) => ({
        ...track,
        priority: track.priority ?? DEFAULT_PRIORITY,
        order: index,
      }));
    },
    forPlayback() {
      return this.playbackTracks();
    },
  };
}
export type Arrangement = ReturnType<typeof createArrangement>;
