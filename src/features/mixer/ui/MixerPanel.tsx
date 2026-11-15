import { useRef } from "react";
import type { Track, Channel } from "@/shared/types";
import { MIXER_CHANNEL_HEIGHT } from "@/shared/constants";
import { useVisibleRows } from "@/shared/virtual";
import { ChannelStrip } from "./ChannelStrip";
import type { LimitedTrackInfo } from "@/features/arrangement/ui/Timeline";

export function MixerPanel({
  tracks,
  channels,
  master,
  running,
  voices,
  limited,
  volume,
  mute,
  setPriority,
  setMaster,
}: {
  tracks: readonly Track[];
  channels: Record<string, Channel>;
  master: number;
  running: boolean;
  voices: Readonly<Record<string, number>>;
  limited: ReadonlyMap<string, LimitedTrackInfo>;
  volume: (id: string, n: number) => void;
  mute: (id: string) => void;
  setPriority: (id: string, n: number) => void;
  setMaster: (n: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 混音台同样虚拟化：64 条轨道时只渲染可见的通道条。
  const range = useVisibleRows(scrollRef, tracks.length, MIXER_CHANNEL_HEIGHT);
  return (
    <section className="panel mixer-panel">
      <div className="section-heading">
        <div>
          <small>03 / BALANCE</small>
          <h2>
            混音台
            {tracks.length > 0 && (
              <span>
                {tracks.length} 条 · 推子作用于真实声道
              </span>
            )}
          </h2>
        </div>
        <span className="tag">LIVE BUS</span>
      </div>
      {tracks.length === 0 ? (
        <p className="empty-small">添加轨道后，在这里平衡每一种声音。</p>
      ) : (
        <div className="mixer-scroll" ref={scrollRef}>
          <div
            className="mixer-virtual"
            style={{ height: tracks.length * MIXER_CHANNEL_HEIGHT }}
          >
            {tracks.slice(range.start, range.end).map((track, offset) => {
              const index = range.start + offset;
              return (
                <div
                  key={track.id}
                  className="mixer-row"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: index * MIXER_CHANNEL_HEIGHT,
                    height: MIXER_CHANNEL_HEIGHT,
                  }}
                >
                  <ChannelStrip
                    track={track}
                    channel={
                      channels[track.id] ?? { volume: 0.75, muted: false }
                    }
                    running={running}
                    voices={voices[track.id] ?? 0}
                    limit={limited.get(track.id)}
                    priority={track.priority ?? 5}
                    setPriority={(n) => setPriority(track.id, n)}
                    volume={(n) => volume(track.id, n)}
                    mute={() => mute(track.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="master">
        <div>
          <strong>主输出</strong>
          <span>{Math.round(master * 100)}%</span>
        </div>
        <input
          aria-label="主音量"
          type="range"
          min="0"
          max="1"
          step=".01"
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
        />
        <small>电平条为设定值 · 声音由本机实时合成</small>
      </div>
    </section>
  );
}
