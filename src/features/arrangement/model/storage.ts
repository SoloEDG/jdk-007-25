import type { Session } from "@/shared/types";
import { MAX_SESSION_CHARS } from "@/shared/constants";
import { validateSession } from "../lib/validation";
const KEY = "nightshift-session-v1";
export function saveSession(session: Session) {
  // 校验与保存都不看声部预算：超出预算的大作品同样完整落盘。
  const safe = validateSession(session);
  const text = JSON.stringify(safe);
  if (text.length > MAX_SESSION_CHARS)
    throw new Error("作品数据超出本机存储上限，已保留当前作品");
  try {
    localStorage.setItem(KEY, text);
  } catch {
    throw new Error("本机存储空间不足，已保留当前作品");
  }
}
export function loadSession() {
  const text = localStorage.getItem(KEY);
  if (!text) throw new Error("还没有本地存档，请先保存");
  if (text.length > MAX_SESSION_CHARS) throw new Error("存档过大，已保留当前作品");
  return validateSession(JSON.parse(text));
}
