import { describe, expect, it } from 'vitest';
import { recallAtK, mrr, percentile } from '@/lib/verified-learning/retrieval/metrics';

describe('检索指标计算', () => {
  it('Recall@K 按期望段落命中比例计算', () => {
    expect(recallAtK([1, 2, 5], [2, 9], 3)).toBe(0.5);
    expect(recallAtK([2, 9], [2, 9], 3)).toBe(1);
    expect(recallAtK([], [2], 3)).toBe(0);
    expect(recallAtK([3, 4], [], 3)).toBe(1);
  });

  it('Recall@K 只看前 K 条且忽略重复段', () => {
    expect(recallAtK([5, 5, 5, 1], [1, 2], 3)).toBe(0);
    expect(recallAtK([5, 5, 1], [1], 2)).toBe(0);
    expect(recallAtK([5, 5, 1], [1], 3)).toBe(1);
  });

  it('MRR 取第一个命中排名的倒数', () => {
    expect(mrr([7, 8, 3], [3])).toBeCloseTo(1 / 3);
    expect(mrr([3, 7], [3, 9])).toBe(1);
    expect(mrr([1, 2], [5])).toBe(0);
  });

  it('百分位数对空值与单值稳定', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBeCloseTo(4.8);
  });
});