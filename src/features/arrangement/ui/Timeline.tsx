import { useEffect, useRef } from "react";
import type { Note, Track } from "@/shared/types";
import { TRACK_ROW_HEIGHT } from "@/shared/constants";
import { useVisibleRows } from "@/shared/virtual";
import { LaneNotes } from "./LaneNotes";

const EMPTY_NOTES: readonly Note[] = [];

export type LimitedTrackInfo = {
  droppedVoices: number;
  reason: "evicted" | "rejected";
};

export function Timeline({
  tracks,
  selected,
  position,
  beats,
  draft,
  limited,
  activeVoices,
  select,
}: {
  tracks: readonly Track[];
  selected: string | null;
  position: number;
  beats: number;
  draft: readonly Note[];
  limited: ReadonlyMap<string, LimitedTrackInfo>;
  activeVoices: Readonly<Record<string, number>>;
  select: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const range = useVisibleRows(scrollRef, tracks.length, TRACK_ROW_HEIGHT);
  const selectedIndex = selected
    ? tracks.findIndex((track) => track.id === selected)
    : -1;

  // 选择由 id 决定；这里只在选中的行滚出视口时把它带回可见范围。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || selectedIndex < 0) return;
    const top = selectedIndex * TRACK_ROW_HEIGHT;
    const bottom = top + TRACK_ROW_HEIGHT;
    if (top < node.scrollTop)
      node.scrollTop = Math.max(0, top - TRACK_ROW_HEIGHT);
    else if (bottom > node.scrollTop + node.clientHeight)
      node.scrollTop = bottom - node.clientHeight + TRACK_ROW_HEIGHT;
  }, [selectedIndex]);

  const visible = tracks.slice(range.start, range.end);
  return (
    <div className="timeline-scroll" ref={scrollRef}>
      <div className="timeline" style={{ minWidth: 500 }}>
        <div className="ruler">
          <span>轨道 / TRACK</span>
          <div>
            {Array.from({ length: beats / 4 }, (_, i) => (
              <b key={i}>{String(i + 1).padStart(2, "0")}</b>
            ))}
          </div>
        </div>
        <div
          className="lane-virtual"
          style={{ height: tracks.length * TRACK_ROW_HEIGHT }}
        >
          {visible.map((track, offset) => {
            const index = range.start + offset;
            const limit = limited.get(track.id);
            const voices = activeVoices[track.id] ?? 0;
            return (
              <div
                className={`lane ${selected === track.id ? "selected" : ""}`}
                key={track.id}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: index * TRACK_ROW_HEIGHT,
                  height: TRACK_ROW_HEIGHT,
                }}
              >
                <button className="lane-name" onClick={() => select(track.id)}>
                  <span style={{ color: track.color }}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <strong>{track.name}</strong>
                  <small>
                    {track.instrument === "drums" ? "DRUM MACHINE" : "POLY SYNTH"}
                    {track.priority !== undefined && ` · P${track.priority}`}
                  </small>
                  {limit && (
                    <em
                      className={`limit-badge ${limit.reason}`}
                      title={
                        limit.reason === "rejected"
                          ? "声部预算不足，本轨部分和弦整组未排入"
                          : "为保护现场声音，本轨低优先级回放已让位"
                      }
                    >
                      {limit.reason === "rejected" ? "整组未排入" : "已让位"} ·{" "}
                      {limit.droppedVoices}
                    </em>
                  )}
                  {voices > 0 && (
                    <i className="voice-badge" aria-label={`${voices} 个声部`}>
                      {voices}
                    </i>
                  )}
                </button>
                <div
                  className="lane-notes"
                  style={{ "--bars": beats / 4 } as React.CSSProperties}
                >
                  <LaneNotes
                    notes={track.notes}
                    draft={selected === track.id ? draft : EMPTY_NOTES}
                    beats={beats}
                    color={track.color}
                    instrument={track.instrument}
                  />
                  <i
                    className="playhead"
                    style={{ left: `${(position / beats) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {tracks.length === 0 && (
          <div className="empty-arrangement">
            <span>♫</span>
            <h3>第一拍，从你开始</h3>
            <p>添加鼓组或琴键轨道，录下属于你的循环。</p>
          </div>
        )}
      </div>
    </div>
  );
}
