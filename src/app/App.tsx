import { useStudio } from "./useStudio";
import type { Studio } from "./studio";
import { MAX_TRACKS } from "@/shared/constants";
import { TransportBar, BeatLights } from "@/features/transport";
import { Pads, Keyboard } from "@/features/instruments";
import { Timeline, TrackActions } from "@/features/arrangement";
import { RecordControls, RecordingStatus } from "@/features/recorder";
import { MixerPanel } from "@/features/mixer";
export function App() {
  const s = useStudio();
  if (!s) return <div className="loading">正在打开夜航工作室…</div>;
  const v = s.view(),
    locked = v.recorder.status !== "idle";
  return (
    <div className="studio-shell">
      <aside className="rail">
        <a href="#workspace" className="brand-mark" aria-label="夜航工作室">
          n<span>↗</span>
        </a>
        <span className="rail-icon active" title="工作室">
          ▥
        </span>
        <span className="rail-label">NIGHTSHIFT</span>
        <span className="rail-bottom">01</span>
      </aside>
      <main id="workspace">
        <header>
          <div>
            <div className="eyebrow">YOUR IDEAS, IN THE LOOP.</div>
            <h1>
              夜航<span> / </span>
              <em>Nightshift</em>
              <sup>STUDIO</sup>
            </h1>
            <p>让灵感，循环发生。</p>
          </div>
          <div className="header-actions">
            <span className="local-badge">
              <i /> 本地工作空间
            </span>
            <button onClick={s.load}>↺ 恢复</button>
            <button className="save" onClick={s.save}>
              保存作品 ↗
            </button>
          </div>
        </header>
        <div className="session-title">
          <span>当前作品</span>
          <strong>{v.arrangement.title}</strong>
          <button disabled={locked} onClick={s.demo}>
            试听示范 ↗
          </button>
          <button disabled={locked} onClick={s.largeDemo}>
            大编制示范 ↗
          </button>
        </div>
        <TransportBar
          view={v.transport}
          play={() => void s.play()}
          pause={s.pause}
          stop={s.stop}
          configure={s.configure}
          disabled={locked}
        />
        <div className="workspace-grid">
          <section className="panel arrangement-panel">
            <div className="section-heading">
              <div>
                <small>01 / ARRANGE</small>
                <h2>
                  循环编排<span>{v.transport.beats / 4} BARS</span>
                </h2>
              </div>
              <BeatLights
                position={v.transport.position}
                running={v.transport.running}
              />
            </div>
            <TrackActions
              selected={v.selected}
              count={v.arrangement.tracks.length}
              locked={locked}
              add={s.add}
              clear={s.clear}
              remove={s.remove}
            />
            <Timeline
              tracks={v.arrangement.tracks}
              selected={v.arrangement.selected}
              position={v.transport.position}
              beats={v.transport.beats}
              draft={v.recorder.draft}
              limited={v.limited}
              activeVoices={v.budget.active}
              select={s.select}
            />
            <div className="arrangement-footer">
              <BudgetSummary budget={v.budget} tracks={v.arrangement.tracks} />
              <span>
                <i className="color-dot" />{" "}
                {v.selected
                  ? `已选择 ${v.selected.name}`
                  : "选择一条轨道开始演奏"}
              </span>
              <span>4/4 拍 · 最多 {MAX_TRACKS} 条轨道</span>
            </div>
          </section>
          <MixerPanel
            tracks={v.arrangement.tracks}
            channels={v.mixer.channels}
            master={v.mixer.master}
            running={v.transport.running}
            voices={v.budget.active}
            limited={v.limited}
            volume={s.volume}
            mute={s.mute}
            setPriority={s.setPriority}
            setMaster={s.master}
          />
          <section className="panel performance-panel">
            <div className="section-heading">
              <div>
                <small>02 / PERFORM</small>
                <h2>
                  演奏台
                  <span>
                    {v.selected?.instrument === "keys"
                      ? "POLY SYNTH"
                      : "DRUM MACHINE"}
                  </span>
                </h2>
              </div>
              <RecordControls
                state={v.recorder}
                canRecord={!!v.selected}
                record={() => void s.record()}
                cancel={s.cancel}
                setGrid={s.grid}
              />
            </div>
            <div className="instrument-label">
              <span>
                {v.selected?.instrument === "keys"
                  ? "柔和三角波 / WARM TRIANGLE"
                  : "经典合成鼓组 / ANALOG KIT"}
              </span>
              <span>鼠标 · 触控 · 键盘</span>
            </div>
            {v.selected?.instrument === "keys" ? (
              <Keyboard active={v.active} down={s.down} up={s.up} />
            ) : (
              <Pads active={v.active} down={s.down} up={s.up} />
            )}
            <RecordingStatus
              state={v.recorder}
              absolute={v.transport.absolute}
            />
          </section>
        </div>
        <footer>
          <span role="status">{v.message}</span>
          <span>
            <kbd>Space</kbd> 播放 / 暂停 <b>·</b>{" "}
            {v.selected?.instrument === "keys"
              ? "A – K 演奏琴键"
              : "Q W E R 演奏鼓组"}
          </span>
        </footer>
      </main>
    </div>
  );
}

/**
 * 声部预算的可解释状态：总名额、现场保护数、回放数、受限轨道。
 * 这让人一眼看出「哪些轨道被限制、为什么」，而不是和弦莫名少一半。
 */
function BudgetSummary({
  budget,
  tracks,
}: {
  budget: ReturnType<Studio["budget"]>;
  tracks: readonly { id: string; name: string }[];
}) {
  const names = new Map(tracks.map((track) => [track.id, track.name]));
  const labels = budget.limited
    .slice(0, 3)
    .map(
      (entry) =>
        `${names.get(entry.trackId) ?? "?"}${entry.reason === "rejected" ? "（整组未排入）" : "（让位）"}`,
    )
    .join("、");
  const more = budget.limited.length > 3 ? ` 等 ${budget.limited.length} 条` : "";
  return (
    <span
      className={
        budget.limited.length ? "budget-summary limited" : "budget-summary"
      }
      title="声部预算：现场按住与录音中的声音优先，其次按轨道优先级保留回放"
    >
      声部 {budget.used}/{budget.limit}
      {" · "}现场 {budget.held + budget.recording}
      {" · "}回放 {budget.playback}
      {budget.limited.length > 0 && (
        <>
          {" · "}受限：{labels}
          {more}
        </>
      )}
    </span>
  );
}
