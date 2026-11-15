import type { Channel, Track } from "@/shared/types";
import { decibels } from "../lib/levels";
import type { LimitedTrackInfo } from "@/features/arrangement/ui/Timeline";
export function ChannelStrip({
  track,
  channel,
  volume,
  mute,
  running,
  voices,
  limit,
  priority,
  setPriority,
}: {
  track: Track;
  channel: Channel;
  volume: (n: number) => void;
  mute: () => void;
  running: boolean;
  voices: number;
  limit?: LimitedTrackInfo;
  priority: number;
  setPriority: (n: number) => void;
}) {
  return (
    <div className={`channel-strip ${channel.muted ? "muted" : ""}`}>
      <div className="strip-head">
        <span className="color-dot" style={{ background: track.color }} />
        <strong>{track.name}</strong>
        <label className="priority-pick" title="声部优先级：数字越大越重要">
          P
          <select
            aria-label={`${track.name} 声部优先级`}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={mute}
          aria-label={`${channel.muted ? "取消静音" : "静音"} ${track.name}`}
          aria-pressed={channel.muted}
        >
          M
        </button>
      </div>
      <div className="fader-line">
        <input
          aria-label={`${track.name} 音量`}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={channel.volume}
          onChange={(e) => volume(Number(e.target.value))}
        />
        <span>{decibels(channel.muted ? 0 : channel.volume)}</span>
      </div>
      <div className="level-track">
        <i
          style={{
            width: `${running && !channel.muted ? channel.volume * 100 : 0}%`,
            background: track.color,
          }}
        />
        <b
          className={`voice-meter ${limit ? "limited" : ""}`}
          title="当前实际占用声部"
        >
          {limit
            ? limit.reason === "rejected"
              ? `−${limit.droppedVoices} 整组`
              : `−${limit.droppedVoices} 让位`
            : `${voices} 声部`}
        </b>
      </div>
    </div>
  );
}
