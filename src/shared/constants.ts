/** 舞台最多容纳的轨道数。旧版本上限为 8。 */
export const MAX_TRACKS = 64;

/** 单条轨道可保存的音符上限（录制与存档共用）。 */
export const MAX_NOTES_PER_TRACK = 2048;

/**
 * 同时发声的合成声部预算。轨道数可以很多，但真正占用音频图的是
 * 振荡器/噪声源；用一个固定的、可解释的预算把负载压在安全范围内。
 */
export const VOICE_BUDGET = 128;

/** 一条轨道在编排视图中的固定行高（虚拟滚动用）。 */
export const TRACK_ROW_HEIGHT = 75;

/** 一个混音通道条在混音台中的固定高度（虚拟滚动用）。 */
export const MIXER_CHANNEL_HEIGHT = 92;

/** 旧存档没有声部优先级时使用的默认值（保持原作品的听感）。 */
export const DEFAULT_PRIORITY = 5;

/** 存档文本的软上限；声部预算永远不会成为保存时丢弃音符的理由。 */
export const MAX_SESSION_CHARS = 32_000_000;
