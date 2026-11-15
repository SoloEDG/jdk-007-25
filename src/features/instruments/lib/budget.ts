import type {
  VoiceBudgetReport,
  VoiceClass,
  VoiceLimitReason,
} from "@/shared/types";

/**
 * 一次「原子声部组」的申请。回放时同一条轨道、同一瞬间触发的全部音符
 * （一个和弦，或鼓组的一记组合音）必须整体获得或整体拒绝，绝不截半。
 * 现场按住 / 正在录音的声部也走同一本账，只是不可被淘汰。
 */
export type BudgetVoiceRequest = {
  id: string;
  start: number;
  end: number;
};

export type BudgetGroupRequest = {
  trackId: string;
  order: number;
  priority: number;
  klass: VoiceClass;
  start: number;
  end: number;
  voices: readonly BudgetVoiceRequest[];
};

export type BudgetAdmission = {
  accepted: boolean;
  /** 实际占用的声部 id（接受时等于请求中的全部 id）。 */
  voiceIds: string[];
  /** 为了让位而被立刻停掉的旧声部 id。 */
  evictedVoiceIds: string[];
};

type Voice = BudgetVoiceRequest & { klass: VoiceClass };
type Group = {
  id: string;
  trackId: string;
  order: number;
  priority: number;
  klass: VoiceClass;
  seq: number;
  start: number;
  end: number;
  voices: Map<string, Voice>;
};
type LimitEntry = {
  trackId: string;
  droppedVoices: number;
  reason: VoiceLimitReason;
  until: number;
};

/** 受限提示在声音结束后再保留一小段时间，界面才有机会让人看见。 */
const LIMIT_GRACE = 1.2;

const isPlayback = (group: Group) => group.klass === "playback";
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && a.end > b.start;

/**
 * 声部预算只负责「记账与淘汰」，不创建任何音频节点。
 * 心智模型：进一个声部组，出一个声部组；所有淘汰都按
 * (轨道优先级, 轨道顺序, 申请先后) 排序，结果可复现、可解释。
 *
 * 记账按时间区间计算：预排的未来声音只在真正与其他声音重叠时才占用名额，
 * 因此提前排程不会无故挤掉当前正在播放的和弦。
 */
export function createVoiceBudget(initialLimit: number) {
  let limit = Math.max(1, Math.floor(initialLimit));
  let sequence = 0;
  const groups = new Map<string, Group>();
  const limited = new Map<string, LimitEntry>();

  const newGroup = (request: BudgetGroupRequest): Group => {
    const seq = ++sequence;
    return {
      id: `g${seq}`,
      trackId: request.trackId,
      order: request.order,
      priority: request.priority,
      klass: request.klass,
      seq,
      start: request.start,
      end: request.end,
      voices: new Map(
        request.voices.map(
          (voice) => [voice.id, { ...voice, klass: request.klass }] as const,
        ),
      ),
    };
  };

  const commit = (request: BudgetGroupRequest) => {
    const group = newGroup(request);
    groups.set(group.id, group);
    return group;
  };

  const allocated = () => {
    let total = 0;
    for (const group of groups.values()) total += group.voices.size;
    return total;
  };

  /** 只统计与 [start, end) 真正重叠的已分配声部。 */
  const concurrent = (start: number, end: number) => {
    let total = 0;
    for (const group of groups.values())
      for (const voice of group.voices.values())
        if (voice.start < end && voice.end > start) total++;
    return total;
  };

  const markLimited = (
    trackId: string,
    droppedVoices: number,
    reason: VoiceLimitReason,
    end: number,
    now: number,
  ) => {
    const previous = limited.get(trackId);
    // 过期（含被 prune 清掉）后重新计数，数字不会无限增长。
    const alive = previous && previous.until > now ? previous : null;
    limited.set(trackId, {
      trackId,
      droppedVoices: (alive?.droppedVoices ?? 0) + droppedVoices,
      reason:
        alive?.reason === "rejected" || reason === "rejected"
          ? "rejected"
          : "evicted",
      until: Math.max(end, now) + LIMIT_GRACE,
    });
  };

  const removeGroup = (group: Group): string[] => {
    groups.delete(group.id);
    return [...group.voices.keys()];
  };

  /**
   * 淘汰顺序完全可解释：
   * 1. 只有回放声部会被淘汰，现场按住 / 正在录音的声部不在候选里；
   * 2. 轨道优先级低的先让位；
   * 3. 同优先级时，编排里靠后的轨道先让位（前面的轨道更「重要」）；
   * 4. 同一条轨道内部，先让出更早排队的旧声部组。
   * 传入 incoming 时只列出比它更不重要、且与它时间重叠的声部。
   */
  const evictionCandidates = (
    incoming: BudgetGroupRequest,
    strict: boolean,
  ) =>
    [...groups.values()]
      .filter((group) => {
        if (!isPlayback(group) || !overlaps(group, incoming)) return false;
        // 现场按住 / 正在录音的声音拥有绝对优先权：任何回放声部都可以让位。
        if (!strict) return true;
        if (group.priority !== incoming.priority)
          return group.priority < incoming.priority;
        // 同优先级：只允许新组接替同一轨道的旧声音，或淘汰更靠后轨道的声部；
        // 更靠前的轨道即便同优先级也保留。
        return (
          group.trackId === incoming.trackId || group.order > incoming.order
        );
      })
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          b.order - a.order ||
          a.seq - b.seq ||
          a.id.localeCompare(b.id),
      );

  /**
   * 尝试为 request 腾出空间。返回被淘汰的声部，或 null（整组拒绝）。
   * `strict` 为 true 时用于回放：腾不出就整组拒绝，不白掐别的声部。
   * 现场声音（strict = false）优先：即使腾不出也照常发声，宁可短暂超额。
   */
  const makeRoom = (
    request: BudgetGroupRequest,
    now: number,
    strict: boolean,
  ): { evicted: string[]; accepted: boolean } => {
    const size = request.voices.length;
    if (size === 0) return { evicted: [], accepted: true };
    if (size > limit)
      return strict
        ? { evicted: [], accepted: false }
        : { evicted: [], accepted: true };
    let excess = concurrent(request.start, request.end) + size - limit;
    if (excess <= 0) return { evicted: [], accepted: true };
    const candidates = evictionCandidates(request, strict);
    /** 淘汰一个整组实际能减少的「同时发声数」：与本次申请时间重叠的声部。 */
    const overlapCount = (group: Group) => {
      let count = 0;
      for (const voice of group.voices.values())
        if (overlaps(voice, request)) count++;
      return count;
    };
    if (strict) {
      let available = 0;
      for (const group of candidates) {
        available += overlapCount(group);
        if (available >= excess) break;
      }
      if (available < excess) return { evicted: [], accepted: false };
    }
    const evicted: string[] = [];
    for (const group of candidates) {
      if (excess <= 0) break;
      const freed = overlapCount(group);
      const removed = removeGroup(group);
      if (removed.length === 0) continue;
      evicted.push(...removed);
      excess -= freed;
      markLimited(
        group.trackId,
        removed.length,
        "evicted",
        Math.max(group.end, now),
        now,
      );
    }
    return { evicted, accepted: true };
  };

  const admit = (
    request: BudgetGroupRequest,
    now: number,
    strict: boolean,
  ): BudgetAdmission => {
    const { evicted, accepted } = makeRoom(request, now, strict);
    if (!accepted) {
      markLimited(
        request.trackId,
        request.voices.length,
        "rejected",
        Math.max(request.end, now),
        now,
      );
      return { accepted: false, voiceIds: [], evictedVoiceIds: evicted };
    }
    commit(request);
    return {
      accepted: true,
      voiceIds: request.voices.map((voice) => voice.id),
      evictedVoiceIds: evicted,
    };
  };

  return {
    limit: () => limit,
    used: allocated,
    setLimit(next: number) {
      limit = Math.max(1, Math.floor(next));
    },
    /** 释放已自然结束的声部与过期的受限提示，避免记账随时间累积。 */
    prune(now: number) {
      const ended: string[] = [];
      for (const group of [...groups.values()]) {
        for (const [id, voice] of [...group.voices]) {
          if (voice.end <= now) {
            group.voices.delete(id);
            ended.push(id);
          }
        }
        if (group.voices.size === 0) groups.delete(group.id);
      }
      for (const [trackId, entry] of [...limited])
        if (entry.until <= now) limited.delete(trackId);
      return ended;
    },
    /** 现场按住 / 正在录音：永不因预算被掐，必要时可让低优先级回放让位。 */
    admitProtected(request: BudgetGroupRequest, now: number) {
      return admit(request, now, false);
    },
    /** 回放：整组获得或整组拒绝，可淘汰更不重要的回放声部。 */
    admitPlayback(request: BudgetGroupRequest, now: number) {
      return admit(request, now, true);
    },
    /** 静音、删轨、清空时立即归还该轨道的全部声部。 */
    stopTrack(trackId: string) {
      const removed: string[] = [];
      for (const group of [...groups.values()])
        if (group.trackId === trackId) removed.push(...removeGroup(group));
      limited.delete(trackId);
      return removed;
    },
    dropVoice(voiceId: string) {
      for (const group of [...groups.values()]) {
        if (group.voices.delete(voiceId)) {
          if (group.voices.size === 0) groups.delete(group.id);
          return true;
        }
      }
      return false;
    },
    /** 合成器给出真实结束时间后校正记账，避免提前归还名额。 */
    extendVoice(voiceId: string, end: number) {
      for (const group of groups.values()) {
        const voice = group.voices.get(voiceId);
        if (!voice) continue;
        voice.end = Math.max(voice.end, end);
        group.end = Math.max(group.end, end);
        return true;
      }
      return false;
    },
    /** 优先级 / 轨道顺序变化后，未来的淘汰立即使用新的排序。 */
    reprioritize(
      next: Readonly<Record<string, { order: number; priority: number }>>,
    ) {
      for (const group of groups.values()) {
        const value = next[group.trackId];
        if (value) {
          group.order = value.order;
          group.priority = value.priority;
        }
      }
    },
    clear() {
      const all: string[] = [];
      for (const group of groups.values()) all.push(...group.voices.keys());
      groups.clear();
      limited.clear();
      return all;
    },
    report(now: number): VoiceBudgetReport {
      const active: Record<string, number> = {};
      let held = 0,
        recording = 0,
        playing = 0;
      for (const group of groups.values()) {
        const count = group.voices.size;
        active[group.trackId] = (active[group.trackId] ?? 0) + count;
        if (group.klass === "recording") recording += count;
        else if (group.klass === "held") held += count;
        else playing += count;
      }
      const limitedTracks = [...limited.values()]
        .filter((entry) => entry.until > now)
        .sort((a, b) => a.trackId.localeCompare(b.trackId))
        .map(({ trackId, droppedVoices, reason }) => ({
          trackId,
          droppedVoices,
          reason,
        }));
      let dropped = 0;
      for (const entry of limitedTracks) dropped += entry.droppedVoices;
      return {
        limit,
        used: held + recording + playing,
        held,
        recording,
        playback: playing,
        dropped,
        active,
        limited: limitedTracks,
      };
    },
  };
}
export type VoiceBudget = ReturnType<typeof createVoiceBudget>;
