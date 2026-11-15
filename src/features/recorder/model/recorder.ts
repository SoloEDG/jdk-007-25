import type {
  Note,
  NoteInput,
  Instrument,
  VoiceClass,
} from "@/shared/types";
import { MAX_NOTES_PER_TRACK } from "@/shared/constants";
import { captureBoundary, recordedNote } from "../lib/quantize";

/**
 * 录音目标用轨道 **id** 固定下来（arm 时写入），之后无论可见行如何滚动、
 * 轨道顺序如何变化，都不会跟着行号漂移。
 * 录音中的每一次发声都标记为 recording，交给声部预算时不可被淘汰。
 */
export function createRecorder() {
  let status: "idle" | "waiting" | "recording" = "idle",
    trackId: string | null = null,
    instrument: Instrument = "drums",
    start = 0,
    length = 16,
    grid = 0.25,
    draft: Note[] = [];
  const held = new Map<string, { note: NoteInput; beat: number }>();
  const release = (id: string, absolute: number) => {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    if (draft.length < MAX_NOTES_PER_TRACK)
      draft.push(
        recordedNote(
          h.note.pitch,
          h.beat - start,
          Math.min(start + length, absolute) - start,
          length,
          h.note.velocity,
          grid,
        ),
      );
  };
  return {
    snapshot() {
      return {
        status,
        trackId,
        start,
        length,
        draft: structuredClone(draft),
        grid,
        held: held.size,
      };
    },
    /** 正在录制的目标轨道 id（不是可见行号）；静音 / 删轨时用它精确归还资源。 */
    target() {
      return trackId;
    },
    grid(value: number) {
      if (status === "idle" && [0.25, 0.5, 1].includes(value)) grid = value;
    },
    arm(id: string, kind: Instrument, absolute: number, beats: number) {
      if (status !== "idle") return;
      trackId = id;
      instrument = kind;
      start = captureBoundary(absolute, beats);
      length = beats;
      draft = [];
      held.clear();
      status = "waiting";
    },
    voiceClass(): VoiceClass {
      return status === "idle" ? "held" : "recording";
    },
    down(id: string, note: NoteInput, absolute: number) {
      if (
        status !== "recording" ||
        note.instrument !== instrument ||
        held.has(id) ||
        draft.length + held.size >= MAX_NOTES_PER_TRACK
      )
        return;
      held.set(id, { note, beat: absolute });
    },
    up: release,
    advance(absolute: number) {
      if (status === "waiting" && absolute >= start) status = "recording";
      if (status === "recording" && absolute >= start + length) {
        for (const id of held.keys()) release(id, start + length);
        const result = { trackId: trackId!, notes: structuredClone(draft) };
        status = "idle";
        trackId = null;
        draft = [];
        held.clear();
        return result;
      }
      return null;
    },
    cancel() {
      status = "idle";
      trackId = null;
      draft = [];
      held.clear();
    },
  };
}
export type Recorder = ReturnType<typeof createRecorder>;
