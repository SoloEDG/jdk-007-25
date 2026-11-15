import type { Session, Note, Track } from "@/shared/types";
const note = (
  pitch: number,
  beat: number,
  duration = 0.18,
  velocity = 0.8,
): Note => ({ id: crypto.randomUUID(), pitch, beat, duration, velocity });
export function demoSession(): Session {
  return {
    version: 1,
    title: "凌晨两点 / After Hours",
    bpm: 108,
    beats: 16,
    master: 0.7,
    channels: {
      rhythm: { volume: 0.8, muted: false },
      chords: { volume: 0.55, muted: false },
      lead: { volume: 0.55, muted: false },
    },
    tracks: [
      {
        id: "rhythm",
        name: "午夜鼓组",
        instrument: "drums",
        color: "#d5f377",
        priority: 7,
        notes: Array.from({ length: 16 }, (_, i) => [
          note(2, i, 0.12, 0.45),
          ...(i % 4 === 0 || i % 4 === 2 ? [note(0, i)] : []),
          ...(i % 4 === 1 || i % 4 === 3 ? [note(1, i, 0.2, 0.65)] : []),
        ]).flat(),
      },
      {
        id: "chords",
        name: "温暖和弦",
        instrument: "keys",
        color: "#bca5f4",
        priority: 5,
        notes: [0, 4, 8, 12].flatMap((b, i) =>
          [60, 64, 67].map((p) =>
            note(p + (i % 2 === 1 ? -3 : 0), b, 3.6, 0.4),
          ),
        ),
      },
      {
        id: "lead",
        name: "夜间旋律",
        instrument: "keys",
        color: "#8fbfff",
        priority: 8,
        notes: [72, 67, 69, 64, 67, 64, 62, 60].map((p, i) =>
          note(p, i * 2, 0.8, 0.55),
        ),
      },
    ],
  };
}

/**
 * 大编制示范：32 条轨道、每 4 拍齐奏六音和弦，远超默认声部预算，
 * 用来验证「完整保存 + 整组淘汰 + 不掐现场声音」。
 */
export function largeDemoSession(count = 32): Session {
  const colors = [
    "#d5f377", "#bca5f4", "#8fbfff", "#f4af84", "#80cfbb",
    "#ed94b4", "#cec080", "#a6b6c9",
  ];
  const tracks: Track[] = Array.from({ length: count }, (_, i) => {
    const drums = i % 4 === 0;
    const base = 48 + (i % 12) * 2;
    return {
      id: `large-${i}`,
      name: `${drums ? "鼓组" : "琴键"} ${i + 1}`,
      instrument: drums ? "drums" : "keys",
      color: colors[i % colors.length],
      priority: 1 + (i % 9),
      notes: drums
        ? Array.from({ length: 16 }, (_, b) => note(b % 4, b, 0.12, 0.5))
        : [0, 4, 8, 12].flatMap((b) =>
            [0, 3, 7, 10, 12, 15].map((offset) =>
              note(base + offset, b, 3.6, 0.35),
            ),
          ),
    };
  });
  return {
    version: 1,
    title: "大编制 / Large Ensemble",
    bpm: 112,
    beats: 16,
    master: 0.7,
    channels: Object.fromEntries(
      tracks.map((track) => [track.id, { volume: 0.6, muted: false }]),
    ),
    tracks,
  };
}
