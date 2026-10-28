// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { loadTutorHistory, saveTutorHistory, TUTOR_HISTORY_LIMIT } from '@/lib/stores/tutor-history';

const message = (i: number): UIMessage => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `第 ${i} 条` }] });

afterEach(() => localStorage.clear());

describe('助教对话记录：按会话存在浏览器 localStorage', () => {
  it('追加 45 条只保留最近 40 条', () => {
    expect(TUTOR_HISTORY_LIMIT).toBe(40);
    saveTutorHistory('s1', Array.from({ length: 45 }, (_, i) => message(i)));
    const saved = loadTutorHistory('s1');
    expect(saved).toHaveLength(40);
    expect(saved[0].id).toBe('m5');
    expect(saved.at(-1)?.id).toBe('m44');
  });
  it('不同会话互不影响，键为 vl-tutor-<sessionId>', () => {
    saveTutorHistory('s1', [message(0)]);
    saveTutorHistory('s2', [message(1), message(2)]);
    expect(loadTutorHistory('s1').map(m => m.id)).toEqual(['m0']);
    expect(loadTutorHistory('s2')).toHaveLength(2);
    expect(Object.keys(localStorage).sort()).toEqual(['vl-tutor-s1', 'vl-tutor-s2']);
  });
  it('没有记录或记录损坏时为空数组', () => {
    expect(loadTutorHistory('none')).toEqual([]);
    localStorage.setItem('vl-tutor-bad', '{不是 JSON');
    expect(loadTutorHistory('bad')).toEqual([]);
  });
});
