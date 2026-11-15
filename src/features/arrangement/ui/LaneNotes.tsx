import { memo } from "react";
import type { Note } from "@/shared/types";

/**
 * 单条轨道的音符层。与播放头分离并 memo 化：
 * 播放时每秒 50 次的刷新只会改播放头的位置，不会重新创建成千上万个音符块。
 */
export const LaneNotes = memo(
  function LaneNotes({
    notes,
    draft,
    beats,
    color,
    instrument,
  }: {
    notes: readonly Note[];
    draft: readonly Note[];
    beats: number;
    color: string;
    instrument: "drums" | "keys";
  }) {
    const all = draft.length ? [...notes, ...draft] : notes;
    return (
      <>
        {all.map((n) => (
          <span
            className={`note-block ${draft.includes(n) ? "draft" : ""}`}
            key={n.id}
            style={{
              left: `${(n.beat / beats) * 100}%`,
              width: `${Math.max(0.6, (Math.min(n.duration, beats - n.beat) / beats) * 100)}%`,
              top: `${12 + (instrument === "drums" ? n.pitch : (((72 - n.pitch) % 12) + 12) % 12) * 3}%`,
              background: color,
            }}
          />
        ))}
      </>
    );
  },
  (prev, next) =>
    prev.notes === next.notes &&
    prev.beats === next.beats &&
    prev.color === next.color &&
    prev.instrument === next.instrument &&
    prev.draft.length === next.draft.length &&
    prev.draft.every((note, i) => note.id === next.draft[i].id),
);
