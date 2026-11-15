export type Instrument = "drums" | "keys";
export type Note = {
  id: string;
  pitch: number;
  beat: number;
  duration: number;
  velocity: number;
};
export type Track = {
  id: string;
  name: string;
  instrument: Instrument;
  color: string;
  /**
   * 声部优先级：1（最先让出）到 9（最后让出）。旧存档缺失时归一为 5。
   * 同优先级时，越靠前的轨道越重要。
   */
  priority: number;
  notes: Note[];
};
export type Channel = { volume: number; muted: boolean };
export type Session = {
  version: 1;
  title: string;
  bpm: number;
  beats: number;
  tracks: Track[];
  channels: Record<string, Channel>;
  master: number;
};
export type NoteInput = {
  pitch: number;
  velocity: number;
  instrument: Instrument;
};
export type ScheduledNote = NoteInput & {
  duration: number;
  when: number;
  trackId: string;
  priority?: number;
  order?: number;
};
/** 一次调度中的同一瞬间，同一条轨道的全部音符（一个和弦）作为原子声部组。 */
export type ScheduledGroup = {
  trackId: string;
  when: number;
  priority: number;
  order: number;
  notes: ScheduledNote[];
};
export type VoiceClass = "held" | "recording" | "playback";
export type VoiceLimitReason = "evicted" | "rejected";
export type VoiceBudgetReport = {
  limit: number;
  used: number;
  held: number;
  recording: number;
  playback: number;
  dropped: number;
  /** 每条轨道当前实际占用的声部数（按轨道 id，而不是可见行号）。 */
  active: Record<string, number>;
  limited: {
    trackId: string;
    droppedVoices: number;
    reason: VoiceLimitReason;
  }[];
};
export type Listener = () => void;
