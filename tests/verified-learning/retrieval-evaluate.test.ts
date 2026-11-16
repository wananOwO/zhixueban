import { describe, expect, it } from 'vitest';
import { evaluate, fixtureSource, loadFixture, syntheticEmbedding, toMarkdown } from '@/lib/verified-learning/retrieval/evaluate';

describe('检索评测', () => {
  it('固定测试集至少 30 题且语料覆盖全部期望段号', () => {
    const fixture = loadFixture('tests/fixtures/retrieval/test.json');
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30);
    const indices = new Set(fixture.corpus.map(item => item.index));
    for (const item of fixture.cases) for (const index of item.expectedParagraphs) expect(indices.has(index)).toBe(true);
  });

  it('开发集至少 20 题，与测试集不重复', () => {
    const dev = loadFixture('tests/fixtures/retrieval/dev.json');
    const test = loadFixture('tests/fixtures/retrieval/test.json');
    expect(dev.cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(dev.cases.map(c => c.query)).size).toBe(dev.cases.length);
    const overlap = dev.cases.map(c => c.query).filter(query => new Set(test.cases.map(t => t.query)).has(query));
    expect(overlap).toEqual([]);
  });

  it('语料快照哈希稳定，段号沿用 fixture', () => {
    const fixture = loadFixture('tests/fixtures/retrieval/dev.json');
    const a = fixtureSource(fixture);
    const b = fixtureSource(fixture);
    expect(a.sourceRevision).toBe(b.sourceRevision);
    expect(a.chapters[0].paragraphs.map(p => p.paragraphIndex)).toEqual(fixture.corpus.map(item => item.index));
  });

  it('三种策略都能产出可复现指标，引用全部合法', async () => {
    const report = await evaluate({ fixtureFile: 'tests/fixtures/retrieval/test.json', gitRevision: 'test-rev' });
    expect(report.strategies.map(item => item.strategy)).toEqual(['keyword', 'vector', 'hybrid']);
    expect(report.gitRevision).toBe('test-rev');
    for (const strategy of report.strategies) {
      expect(strategy.cases).toHaveLength(30);
      expect(strategy.citationValidity).toBe(1);
      expect(strategy.recall5).toBeGreaterThanOrEqual(0);
      expect(strategy.recall5).toBeLessThanOrEqual(1);
    }
    const markdown = toMarkdown(report);
    expect(markdown).toContain('Recall@5');
    expect(markdown).toContain('分类型');
  });

  it('混合检索在固定测试集上不弱于关键词基线', async () => {
    const report = await evaluate({ fixtureFile: 'tests/fixtures/retrieval/test.json' });
    const keyword = report.strategies.find(item => item.strategy === 'keyword')!;
    const hybrid = report.strategies.find(item => item.strategy === 'hybrid')!;
    expect(hybrid.recall5).toBeGreaterThanOrEqual(keyword.recall5);
  });

  it('本地合成向量对相同文本给出相同向量', async () => {
    const embed = syntheticEmbedding(64);
    const [a] = await embed(['递归终止条件']);
    const [b] = await embed(['递归终止条件']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });
});