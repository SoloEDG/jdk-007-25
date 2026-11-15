import type {
  Instrument,
  ScheduledGroup,
  ScheduledNote,
  VoiceBudgetReport,
  VoiceClass,
} from "@/shared/types";
import { synthesize, voiceLength, type Voice } from "../lib/voices";
import { createVoiceBudget } from "../lib/budget";
import { VOICE_BUDGET } from "@/shared/constants";

type RuntimeVoice = {
  voice: Voice;
  trackId: string;
  heldKey: string | null;
  /** 按住期间不随时间回收；松手时由 release 立即归还。 */
  endsAt: number;
};

const voiceId = () => crypto.randomUUID();

export function createEngine(limit = VOICE_BUDGET) {
  let context: AudioContext | null = null;
  let destination: ((id: string) => AudioNode) | null = null;
  const budget = createVoiceBudget(limit);
  /** 所有正在发声的音频节点，按声部 id 索引；与可见行无关。 */
  const voices = new Map<string, RuntimeVoice>();
  const held = new Map<string, string>();

  const now = () => context?.currentTime ?? 0;

  /**
   * 归还一个声部：停止音频节点、删除预算记账、解除按住的键。
   * 三者必须一起做，否则反复播放 / 滚动会让记账与节点漂移。
   */
  const retire = (id: string) => {
    const runtime = voices.get(id);
    runtime?.voice.stop();
    voices.delete(id);
    budget.dropVoice(id);
    if (runtime?.heldKey && held.get(runtime.heldKey) === id)
      held.delete(runtime.heldKey);
  };

  const stopIds = (ids: readonly string[]) => {
    for (const id of ids) retire(id);
  };

  /** 释放已经自然结束或已被预算淘汰的声部，避免节点与记账随时间累积。 */
  const sweep = (time = now()) => {
    for (const id of budget.prune(time)) retire(id);
    for (const [id, runtime] of [...voices])
      if (runtime.endsAt <= time) retire(id);
    for (const [key, id] of [...held]) if (!voices.has(id)) held.delete(key);
  };

  const startGroup = (
    notes: readonly ScheduledNote[],
    trackId: string,
    klass: VoiceClass,
    startAt: number,
    endAt: number,
    priority: number,
    order: number,
    heldKey: string | null,
    holdWhileHeld: boolean,
  ) => {
    if (!context || !destination) return false;
    // 回收放在每个 tick 的 sweep 里统一做：一次调度窗口内批量排入上百个声部时
    // 不会因为「每入一个就全表扫描一次」而退化成平方复杂度。
    const candidates = notes.map((note) => {
      const id = voiceId();
      return { id, note };
    });
    const request = {
      trackId,
      order,
      priority,
      klass,
      start: startAt,
      end: endAt,
      voices: candidates.map(({ id }) => ({ id, start: startAt, end: endAt })),
    };
    const admission =
      klass === "playback"
        ? budget.admitPlayback(request, context.currentTime)
        : budget.admitProtected(request, context.currentTime);
    stopIds(admission.evictedVoiceIds);
    if (!admission.accepted) return false;
    let output: AudioNode;
    try {
      output = destination(trackId);
    } catch {
      // 声道已被释放（例如同一帧内删轨）：把刚申请的名额原样归还。
      for (const { id } of candidates) budget.dropVoice(id);
      return false;
    }
    for (const { id, note } of candidates) {
      try {
        const voice = synthesize(context, output, note);
        budget.extendVoice(id, voice.end);
        voices.set(id, {
          voice,
          trackId,
          heldKey:
            heldKey && note.instrument === "keys" && candidates.length === 1
              ? heldKey
              : null,
          endsAt: holdWhileHeld ? Infinity : voice.end,
        });
        if (heldKey && note.instrument === "keys" && candidates.length === 1)
          held.set(heldKey, id);
      } catch {
        // 单个节点创建失败时归还该声部，不让预算账目漂移。
        budget.dropVoice(id);
      }
    }
    return true;
  };

  return {
    get context() {
      return context;
    },
    async unlock() {
      context ??= new AudioContext();
      if (context.state === "suspended") await context.resume();
      return context;
    },
    route(resolve: (id: string) => AudioNode) {
      destination = resolve;
    },
    /** 回放：同一瞬间同一条轨道的全部音符作为一个原子组参与预算。 */
    playGroup(group: ScheduledGroup) {
      if (!context || !destination || group.notes.length === 0) return false;
      const start = Math.max(context.currentTime, group.when);
      const end = Math.max(
        start,
        ...group.notes.map((note) => start + voiceLength(note)),
      );
      return startGroup(
        group.notes,
        group.trackId,
        "playback",
        start,
        end + 0.04,
        group.priority,
        group.order,
        null,
        false,
      );
    },
    /**
     * 现场演奏：正在按住 / 正在录音的声音永远不会被预算掐掉，
     * 预算只会在必要时让低优先级的回放声部让位。
     */
    playLive(note: ScheduledNote, key: string | undefined, recording: boolean) {
      if (!context || !destination) return false;
      const klass: VoiceClass = recording ? "recording" : "held";
      const start = Math.max(context.currentTime, note.when);
      const sustain = note.instrument === "keys" && !!key;
      // 按住的琴键在松手前一直占用名额（并保护它）；鼓组等一击即散的声音
      // 按合成器真实长度归还，不会留下无人释放的声部。
      const end = sustain ? Infinity : start + voiceLength(note);
      return startGroup(
        [{ ...note, when: start }],
        note.trackId,
        klass,
        start,
        end,
        note.priority ?? 9,
        note.order ?? 0,
        sustain ? key! : null,
        sustain,
      );
    },
    /** 兼容旧调用：无 key 的即时音符按回放处理。 */
    play(note: ScheduledNote, key?: string) {
      if (key) return this.playLive(note, key, false);
      return this.playGroup({
        trackId: note.trackId,
        when: note.when,
        priority: note.priority ?? 9,
        order: note.order ?? 0,
        notes: [note],
      });
    },
    release(key: string) {
      const id = held.get(key);
      if (id) retire(id);
    },
    releaseHeld() {
      for (const id of [...held.values()]) retire(id);
      held.clear();
    },
    /** 静音 / 删除 / 清空轨道时立即停止该轨道的全部声音并归还预算。 */
    stopTrack(trackId: string) {
      const ids = [
        ...new Set([
          ...[...voices.entries()]
            .filter(([, runtime]) => runtime.trackId === trackId)
            .map(([id]) => id),
          ...budget.stopTrack(trackId),
        ]),
      ];
      stopIds(ids);
    },
    cancel() {
      for (const id of voices.keys()) {
        const runtime = voices.get(id);
        runtime?.voice.stop();
      }
      voices.clear();
      held.clear();
      budget.clear();
    },
    sweep,
    setBudget(next: number) {
      budget.setLimit(next);
    },
    reloadPriorities(
      tracks: Readonly<Record<string, { order: number; priority: number }>>,
    ) {
      budget.reprioritize(tracks);
    },
    /** 纯读取，不产生音频副作用（可在渲染期间安全调用）。 */
    report(time = now()): VoiceBudgetReport {
      return budget.report(time);
    },
    activeFor(trackId: string) {
      return [...voices.values()].filter((v) => v.trackId === trackId).length;
    },
    voiceCount() {
      return voices.size;
    },
    releaseInstrument(_instrument: Instrument) {
      this.cancel();
    },
    dispose() {
      this.cancel();
      void context?.close();
      context = null;
      destination = null;
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
