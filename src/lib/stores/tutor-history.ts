import type { UIMessage } from 'ai';

/**
 * 助教对话记录：按学习会话存在浏览器 localStorage（键 vl-tutor-<sessionId>），刷新保留，
 * 清除浏览器数据即消失；服务器不保存。只保留最近 40 条消息。
 */
export const TUTOR_HISTORY_LIMIT = 40;
const key = (sessionId: string) => `vl-tutor-${sessionId}`;

export function loadTutorHistory(sessionId: string): UIMessage[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key(sessionId)) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveTutorHistory(sessionId: string, messages: UIMessage[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(sessionId), JSON.stringify(messages.slice(-TUTOR_HISTORY_LIMIT)));
  } catch {
    // 存储已满或被禁用时只在本页保留
  }
}

export function clearTutorHistory(sessionId: string): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key(sessionId));
}
