import { createEngine, bindPerformanceInput } from "@/features/instruments";
import {
  createTransport,
  createPlaybackIndex,
  type PlaybackIndex,
} from "@/features/transport";
import { createRecorder } from "@/features/recorder";
import {
  createArrangement,
  demoSession,
  largeDemoSession,
  saveSession,
  loadSession,
} from "@/features/arrangement";
import { createMixer } from "@/features/mixer";
import type { NoteInput, Instrument, Session } from "@/shared/types";
export function createStudio(notify: () => void) {
  const engine = createEngine(),
    transport = createTransport(),
    recorder = createRecorder(),
    arrangement = createArrangement(),
    mixer = createMixer();
  const active = new Set<string>();
  let message = "欢迎来到夜航。戴上耳机，试着敲下第一拍。",
    epoch = 0,
    disposed = false,
    index: PlaybackIndex | null = null,
    indexRevision = -1;
  const now = () => engine.context?.currentTime ?? 0;
  const feedback = (text: string) => {
    message = text;
    notify();
  };
  const guard = (fn: () => void) => {
    try {
      fn();
      notify();
    } catch (error) {
      feedback(
        error instanceof Error ? error.message : "操作失败，现有作品已保留",
      );
    }
  };
  const syncMixer = () =>
    mixer.ensure(arrangement.snapshot().tracks.map((t) => t.id));
  /**
   * 回放索引按作品修订号缓存：滚动、切轨、暂停恢复都不会重建它。
   * 索引覆盖全部 64 条轨道，与当前可见行完全无关。
   */
  const playbackIndex = () => {
    const revision = arrangement.revision();
    if (!index || revision !== indexRevision) {
      index = createPlaybackIndex(arrangement.playbackTracks());
      indexRevision = revision;
    }
    return index;
  };
  /** 轨道顺序 / 优先级变化后，让已排队的声部也按新排序被淘汰。 */
  const priorityMap = () =>
    Object.fromEntries(
      arrangement
        .playbackTracks()
        .map((track, order) => [
          track.id,
          { order, priority: track.priority },
        ]),
    );
  const syncPriorities = () => engine.reloadPriorities(priorityMap());
  const cancelVoices = () => {
    engine.cancel();
    active.clear();
  };
  const stop = () => {
    epoch++;
    transport.stop();
    recorder.cancel();
    cancelVoices();
    notify();
  };
  const pause = () => {
    epoch++;
    transport.pause(now());
    recorder.cancel();
    cancelVoices();
    feedback("播放已暂停；未完成录音已取消，原片段保留。");
  };
  const unlock = async () => {
    const context = await engine.unlock();
    if (disposed) return false;
    mixer.attach(context);
    syncMixer();
    engine.route(mixer.channel);
    return true;
  };
  const play = async () => {
    const token = ++epoch;
    try {
      if (!(await unlock()) || token !== epoch) return;
      transport.start(now() + 0.02);
      tick();
      notify();
    } catch {
      feedback("声音启动失败，请再次点击播放");
    }
  };
  const tick = () => {
    const time = now(),
      view = transport.view(time);
    const take = recorder.advance(view.absolute);
    if (take)
      guard(() => {
        arrangement.commit(take.trackId, take.notes);
        message = `录制完成 · ${take.notes.length} 个音符`;
      });
    const capture = recorder.snapshot();
    const ceiling =
      capture.status === "idle" ? Infinity : capture.start + capture.length;
    const window = transport.window(time, ceiling);
    // 先把自然结束的声部归还，再把本窗口的声音一起送进预算。
    engine.sweep(time);
    if (window) {
      const muted = new Set(mixer.mutedIds());
      const groups = playbackIndex().query(
        window.from,
        window.to,
        view.beats,
        view.bpm,
        window.timeAt,
        muted,
      );
      for (const group of groups) engine.playGroup(group);
    }
  };
  const down = async (id: string, note: NoteInput) => {
    if (active.has(id)) return;
    active.add(id);
    notify();
    try {
      if (!(await unlock()) || !active.has(id)) return;
      const target = arrangement.selected();
      if (!target || target.instrument !== note.instrument) {
        active.delete(id);
        feedback("请先选择对应乐器的轨道");
        return;
      }
      const abs = transport.view(now()).absolute;
      const take = recorder.advance(abs);
      if (take) arrangement.commit(take.trackId, take.notes);
      recorder.down(id, note, abs);
      engine.playLive(
        {
          ...note,
          trackId: target.id,
          duration: note.instrument === "keys" ? 6 : 0.3,
          when: now(),
          priority: 9,
          order: arrangement.indexOf(target.id),
        },
        id,
        recorder.voiceClass() === "recording",
      );
    } catch {
      active.delete(id);
      feedback("请点击播放以启用声音");
    }
  };
  const up = (id: string) => {
    if (!active.delete(id)) return;
    recorder.up(id, transport.view(now()).absolute);
    engine.release(id);
    notify();
  };
  const install = (session: Session) => {
    stop();
    const valid = arrangement.restore(session);
    transport.configure(valid.bpm, valid.beats);
    mixer.restore(valid.channels, valid.master);
    syncPriorities();
    notify();
  };
  const timer = window.setInterval(() => {
    tick();
    notify();
  }, 20);
  const unbind = bindPerformanceInput((id, note) => void down(id, note), up);
  const shortcut = (e: KeyboardEvent) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)
    ) {
      e.preventDefault();
      if (transport.view(now()).running) pause();
      else void play();
    }
  };
  const blur = () => {
    for (const id of [...active]) up(id);
  };
  window.addEventListener("keydown", shortcut);
  window.addEventListener("blur", blur);
  return {
    view() {
      const snapshot = arrangement.snapshot();
      const budget = engine.report(now());
      return {
        transport: transport.view(now()),
        arrangement: snapshot,
        selected: arrangement.selected(),
        selectedIndex: arrangement.indexOf(snapshot.selected),
        recorder: recorder.snapshot(),
        mixer: mixer.snapshot(),
        budget,
        limited: new Map(
          budget.limited.map((entry) => [
            entry.trackId,
            { droppedVoices: entry.droppedVoices, reason: entry.reason },
          ]),
        ),
        active: new Set(active),
        message,
      };
    },
    play,
    pause,
    stop,
    down: (id: string, n: NoteInput) => void down(id, n),
    up,
    configure(bpm: number, beats: number) {
      stop();
      transport.configure(bpm, beats);
      arrangement.resizeLoop(transport.view(now()).beats);
      feedback("速度或长度变更：播放回到起点；缩短时移除范围外音符。");
    },
    add(kind: Instrument) {
      guard(() => {
        arrangement.add(kind);
        syncMixer();
        syncPriorities();
      });
    },
    select(id: string) {
      if (recorder.snapshot().status !== "idle") return;
      engine.releaseHeld();
      active.clear();
      arrangement.select(id);
      notify();
    },
    setPriority(id: string, priority: number) {
      guard(() => {
        arrangement.setPriority(id, priority);
        engine.reloadPriorities(priorityMap());
        const track = arrangement.snapshot().tracks.find((t) => t.id === id);
        message = `声部优先级已更新：${track?.name ?? id} P${priority}`;
      });
    },
    remove() {
      guard(() => {
        const selected = arrangement.selected();
        if (!selected) return;
        // 只处理这一条轨道：其它轨道的播放与播放头位置不受影响。
        if (recorder.target() === selected.id) recorder.cancel();
        engine.stopTrack(selected.id);
        arrangement.remove(selected.id);
        mixer.ensure(arrangement.snapshot().tracks.map((t) => t.id));
        syncPriorities();
        message = `已删除 ${selected.name}，声部与声道已归还`;
      });
    },
    clear() {
      guard(() => {
        const selected = arrangement.selected();
        if (!selected) return;
        engine.stopTrack(selected.id);
        arrangement.clear(selected.id);
        message = `已清空 ${selected.name} 的音符，正在发声的声部已归还`;
      });
    },
    async record() {
      const selected = arrangement.selected();
      if (!selected) return;
      const token = ++epoch;
      try {
        if (!(await unlock()) || token !== epoch) return;
        const state = transport.view(now());
        if (!state.running) transport.start(now() + 0.02);
        // 录音目标固定为轨道 id，不随可见行号或滚动位置变化。
        recorder.arm(
          selected.id,
          selected.instrument,
          transport.view(now()).absolute,
          state.beats,
        );
        tick();
        notify();
      } catch {
        feedback("录音启动失败，请重试");
      }
    },
    cancel() {
      recorder.cancel();
      feedback("本次录音已取消，之前的片段仍然保留。");
    },
    grid(n: number) {
      recorder.grid(n);
      notify();
    },
    volume(id: string, n: number) {
      mixer.volume(id, n);
      notify();
    },
    mute(id: string) {
      const muted = mixer.mute(id);
      // 静音立即归还该轨道正在发声的声部；录音仍会继续记录输入。
      if (muted) engine.stopTrack(id);
      if (recorder.target() === id && muted)
        message = "该轨道已静音；录音仍在继续记录";
      notify();
    },
    master(n: number) {
      mixer.master(n);
      notify();
    },
    budget() {
      return engine.report(now());
    },
    demo() {
      guard(() => {
        install(demoSession());
        message = "示范已载入 · 点击播放，听听凌晨两点。";
      });
    },
    largeDemo() {
      guard(() => {
        install(largeDemoSession());
        message =
          "大编制示范已载入 · 32 条轨道远超声部预算，注意看受限标记。";
      });
    },
    save() {
      guard(() => {
        if (recorder.snapshot().status !== "idle")
          throw new Error("请完成或取消录音后再保存");
        const a = arrangement.snapshot(),
          t = transport.view(now()),
          m = mixer.snapshot();
        // 保存读取的是完整作品数据，绝不按声部预算裁剪任何音符。
        saveSession({
          version: 1,
          title: a.title,
          bpm: t.bpm,
          beats: t.beats,
          tracks: a.tracks,
          channels: m.channels,
          master: m.master,
        });
        message = "作品已保存到本机浏览器";
      });
    },
    load() {
      guard(() => {
        const session = loadSession();
        install(session);
        message = "本地作品已恢复";
      });
    },
    dispose() {
      disposed = true;
      epoch++;
      clearInterval(timer);
      unbind();
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("blur", blur);
      mixer.dispose();
      engine.dispose();
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
