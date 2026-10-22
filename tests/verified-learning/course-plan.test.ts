import { describe, expect, it } from 'vitest';
import { planCourse, canMove } from '@/lib/verified-learning/draft-editor';
import { compileCurriculum } from '@/lib/verified-learning/curriculum';

const points = [
  { id: 'loop', title: '循环', prerequisiteIds: [] },
  { id: 'cx', title: '复杂度', prerequisiteIds: ['loop'] },
  { id: 'prefix', title: '前缀和', prerequisiteIds: ['loop', 'cx'] },
  { id: 'dict', title: '字典', prerequisiteIds: [] },
];
const base = { targetIds: ['prefix', 'dict'], excludedIds: [], declaredIds: [], order: null, prerequisiteEdits: [], supplementalSourceIds: [] };

describe('审核页最终课程计算', () => {
  it('目标自动带入先修，并标出状态', () => {
    const plan = planCourse(points, base);
    expect(plan.order).toEqual(['loop', 'cx', 'prefix', 'dict']);
    expect(plan.status.get('loop')).toBe('auto');
    expect(plan.status.get('prefix')).toBe('target');
  });
  it('已掌握的先修不教，其余直接先修仍自动包含', () => {
    const plan = planCourse(points, { ...base, declaredIds: ['cx'] });
    expect(plan.order).toEqual(['loop', 'prefix', 'dict']);
    expect(plan.status.get('cx')).toBe('declared');
    expect(plan.status.get('loop')).toBe('auto');
    expect(planCourse(points, { ...base, targetIds: ['cx'], declaredIds: ['loop'] }).order).toEqual(['cx']);
  });
  it('手动顺序只在覆盖全部知识点时使用', () => {
    expect(planCourse(points, { ...base, order: ['dict', 'loop', 'cx', 'prefix'] }).order).toEqual(['dict', 'loop', 'cx', 'prefix']);
    expect(planCourse(points, { ...base, order: ['prefix', 'dict'] }).order).toEqual(['loop', 'cx', 'prefix', 'dict']);
  });
  it('不能把知识点移到它的先修前面', () => {
    const order = ['loop', 'cx', 'prefix', 'dict'];
    expect(canMove(points, base, order, 'cx', -1)).toBe(false);
    expect(canMove(points, base, order, 'prefix', 1)).toBe(true);
    expect(canMove(points, base, order, 'loop', 1)).toBe(false);
  });
  it('与后端编课结果一致', () => {
    const proposal = { points: points.map(p => ({ ...p, relatedIds: [], citations: [] })), targetIds: base.targetIds, declaredIds: [] };
    const input = { textbookId: 'b', goal: 'g', teachingPrompt: '', includedTopics: [], excludedTopics: [], allowSupplementalSources: false, assessment: { pointQuestionCount: 1, chapterQuestionCount: 1, finalQuestionCount: 1, difficulty: 'easy', progressionPolicy: 'completed' } } as never;
    for (const choices of [base, { ...base, declaredIds: ['cx'] }]) {
      expect(planCourse(points, choices).order).toEqual(compileCurriculum(input, proposal, [], choices).includedIds);
    }
  });
});
