import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "../Timeline";
import { MixerPanel } from "@/features/mixer/ui/MixerPanel";
import type { Track } from "@/shared/types";

const track = (i: number): Track => ({
  id: `t${i}`,
  name: `轨道 ${i + 1}`,
  instrument: i % 2 === 0 ? "keys" : "drums",
  color: "#d5f377",
  priority: 5,
  notes: Array.from({ length: 8 }, (_, n) => ({
    id: `t${i}-${n}`,
    pitch: i % 2 === 0 ? 60 + n : n % 4,
    beat: n,
    duration: 0.5,
    velocity: 0.5,
  })),
});

const tracks = Array.from({ length: 64 }, (_, i) => track(i));

describe("界面按需显示轨道", () => {
  it("64 轨时只渲染视口内的少量行，而不是全部", () => {
    const html = renderToStaticMarkup(
      <Timeline
        tracks={tracks}
        selected={tracks[40].id}
        position={0}
        beats={16}
        draft={[]}
        limited={new Map([[tracks[3].id, { droppedVoices: 5, reason: "evicted" }]])}
        activeVoices={{ [tracks[2].id]: 4 }}
        select={() => {}}
      />,
    );
    const rows = (html.match(/class="lane /g) ?? []).length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(64);
    // 滚动容器的高度代表完整 64 行，滚动后仍能访问后面的轨道。
    expect(html).toContain(`height:${64 * 75}px`);
  });

  it("混音台同样只渲染可见通道条，并显示受限原因", () => {
    const html = renderToStaticMarkup(
      <MixerPanel
        tracks={tracks}
        channels={Object.fromEntries(
          tracks.map((t) => [t.id, { volume: 0.7, muted: false }]),
        )}
        master={0.7}
        running
        voices={{ [tracks[1].id]: 3 }}
        limited={new Map([[tracks[1].id, { droppedVoices: 2, reason: "rejected" }]])}
        volume={() => {}}
        mute={() => {}}
        setPriority={() => {}}
        setMaster={() => {}}
      />,
    );
    const strips = (html.match(/class="channel-strip/g) ?? []).length;
    expect(strips).toBeGreaterThan(0);
    expect(strips).toBeLessThan(64);
    expect(html).toContain("整组");
  });

  it("受限轨道在编排行上有可见标记", () => {
    const html = renderToStaticMarkup(
      <Timeline
        tracks={tracks.slice(0, 4)}
        selected={null}
        position={0}
        beats={16}
        draft={[]}
        limited={new Map([[tracks[2].id, { droppedVoices: 6, reason: "rejected" }]])}
        activeVoices={{}}
        select={() => {}}
      />,
    );
    expect(html).toContain("limit-badge");
    expect(html).toContain("整组未排入");
  });
});
