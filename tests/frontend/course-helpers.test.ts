import { describe, expect, it } from 'vitest';
import { answersNeeded } from '@/lib/course';
import { mergeTraces, summarizeTrace, type TraceView } from '@/lib/trace';

describe('answersNeeded：还要独立答对几道不同题才算掌握', () => {
  // 掌握标准：至少 3 道不同题、最近 5 题答对 80% 以上、最近一题答对
  it('没有作答时要答对 3 道', () => expect(answersNeeded([])).toBe(3));
  it('错 1 对 1 时还要 3 道：答对后最近 5 题 4/5', () => expect(answersNeeded([false, true])).toBe(3));
  it('已达标时为 0', () => expect(answersNeeded([true, true, true])).toBe(0));
  it('最近一题答错时至少 1 道', () => expect(answersNeeded([true, true, true, true, false])).toBe(1));
  it('最近 5 题错 2 道时还要连对 2 道', () => expect(answersNeeded([true, false, true, false, true])).toBe(2));
});

const step = (sourceId: string, from: number, to: number) => ({ at: 1, tool: 'read_source', label: '读取原文', ok: true, read: { sourceId, chapterId: 'c', from, to } });
describe('mergeTraces：合并多个任务的轨迹', () => {
  it('步骤与请求数相加，来源按 sourceId 去重', () => {
    const a: TraceView = { stages: [{ stageId: 'x', requests: 2, steps: [step('b1', 1, 10)] }], sources: [{ sourceId: 'b1', title: '书', paragraphs: 100 }] };
    const b: TraceView = {
      stages: [{ stageId: 'y', requests: 3, steps: [step('b1', 50, 59), step('w1', 1, 5)] }],
      sources: [{ sourceId: 'b1', title: '书', paragraphs: 100 }, { sourceId: 'w1', title: '网页', paragraphs: 20 }],
    };
    const merged = mergeTraces([a, undefined, b]);
    expect(merged.sources.map(s => s.sourceId)).toEqual(['b1', 'w1']);
    const summary = summarizeTrace(merged);
    expect(summary.requests).toBe(5);
    expect(summary.reads).toBe(3);
    expect(summary.perSource.find(s => s.sourceId === 'b1')?.reads).toEqual([[1, 10], [50, 59]]);
  });
  it('全部为空时返回空轨迹', () => expect(mergeTraces([undefined])).toEqual({ stages: [], sources: [] }));
});
