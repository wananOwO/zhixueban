import { describe, expect, it } from 'vitest';
import { ancestors, layoutRoadmap } from '@/lib/roadmap';
import { mergeRanges } from '@/lib/tape';
import { coursePoints } from './fixtures';

describe('先修路线图布局', () => {
  it('真实 18 点课程分为 7 层：第 1 层只有 print()，贪心在第 7 层', () => {
    const layout = layoutRoadmap(coursePoints);
    expect(layout.columns).toHaveLength(7);
    expect(layout.columns[0].map(n => n.id)).toEqual(['py-hello-print']);
    expect(layout.columns[1].map(n => n.id)).toEqual(['py-variables-numbers']);
    expect(layout.columns[6].map(n => n.id)).toEqual(['algo-greedy']);
    expect(layout.depth.get('algo-bfs')).toBe(4);
    // 每个点只出现一次
    expect(layout.columns.flat().map(n => n.id).sort()).toEqual(coursePoints.map(p => p.id).sort());
    // 行号以 0.5 为步长、在同一列内不重复
    for (const column of layout.columns) {
      const rows = column.map(n => n.row);
      expect(new Set(rows).size).toBe(rows.length);
      for (const row of rows) expect(Number.isInteger(row * 2)).toBe(true);
    }
    expect(layout.rows).toBe(Math.max(...layout.columns.map(c => c.length)));
  });

  it('层内按先修位置排序：同一层里先修靠上的排在上面', () => {
    const layout = layoutRoadmap([
      { id: 'a', title: 'a', role: 'prerequisite', prerequisiteIds: [] },
      { id: 'b', title: 'b', role: 'prerequisite', prerequisiteIds: [] },
      { id: 'from-b', title: 'from-b', role: 'target', prerequisiteIds: ['b'] },
      { id: 'from-a', title: 'from-a', role: 'target', prerequisiteIds: ['a'] },
    ]);
    expect(layout.columns[1].map(n => n.id)).toEqual(['from-a', 'from-b']);
  });

  it('忽略指向不存在知识点的先修；先修有环时报错', () => {
    expect(layoutRoadmap([{ id: 'x', title: 'x', role: 'target', prerequisiteIds: ['ghost'] }]).columns).toEqual([[{ id: 'x', row: 0 }]]);
    expect(() => layoutRoadmap([
      { id: 'a', title: 'a', role: 'target', prerequisiteIds: ['b'] },
      { id: 'b', title: 'b', role: 'target', prerequisiteIds: ['a'] },
    ])).toThrow('先修关系存在循环');
  });

  it('祖先链包含自身与全部间接先修', () => {
    const chain = ancestors(coursePoints, 'algo-bfs');
    expect(chain.has('algo-bfs')).toBe(true);
    expect(chain.has('py-hello-print')).toBe(true);
    expect(chain.has('algo-greedy')).toBe(false);
  });
});

describe('书带区间合并', () => {
  it('合并重叠与相邻区间', () => {
    expect(mergeRanges([[748, 767], [680, 699], [690, 710], [728, 747]])).toEqual([[680, 710], [728, 767]]);
    expect(mergeRanges([])).toEqual([]);
    expect(mergeRanges([[5, 5], [6, 9]])).toEqual([[5, 9]]);
  });
});
