import { describe, expect, it } from 'vitest';
import { benchmarkLocalRetrieval, evaluate, fixtureSource, loadFixture, syntheticEmbedding, toMarkdown } from '@/lib/verified-learning/retrieval/evaluate';

describe('检索评测', () => {
  it('固定测试集至少 30 题、覆盖四类问题且语料覆盖全部期望段号', () => {
    const fixture = loadFixture('tests/fixtures/retrieval/test.json');
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30);
    const layers = new Set(fixture.cases.map(item => item.layer));
    expect([...layers]).toEqual(expect.arrayContaining(['keyword', 'semantic', 'context', 'vision']));
    const indices = new Set(fixture.corpus.map(item => item.index));
    for (const item of fixture.cases) {
      for (const index of item.expectedParagraphs) expect(indices.has(index)).toBe(true);
    }
  });

  it('开发集至少 20 题，与测试集按主题隔离且不重复', () => {
    const dev = loadFixture('tests/fixtures/retrieval/dev.json');
    const test = loadFixture('tests/fixtures/retrieval/test.json');
    expect(dev.cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(dev.cases.map(c => c.query)).size).toBe(dev.cases.length);
    const overlap = dev.cases.map(c => c.query).filter(query => new Set(test.cases.map(t => t.query)).has(query));
    expect(overlap).toEqual([]);
  });

  it('语料快照保留多章节结构且哈希稳定，段号沿用 fixture', () => {
    const fixture = loadFixture('tests/fixtures/retrieval/dev.json');
    const a = fixtureSource(fixture);
    const b = fixtureSource(fixture);
    expect(a.sourceRevision).toBe(b.sourceRevision);
    expect(a.chapters.length).toBeGreaterThan(1);
    const allIndices = a.chapters.flatMap(ch => ch.paragraphs.map(p => p.paragraphIndex)).sort((x, y) => x - y);
    expect(allIndices).toEqual(fixture.corpus.map(item => item.index).sort((x, y) => x - y));
  });

  it('三种策略都能产出可复现指标，引用全部 100% 合法', async () => {
    const report = await evaluate({ fixtureFile: 'tests/fixtures/retrieval/test.json', gitRevision: 'test-rev' });
    expect(report.strategies.map(item => item.strategy)).toEqual(['keyword', 'vector', 'hybrid']);
    expect(report.gitRevision).toBe('test-rev');
    expect(report.sourceRevision).toMatch(/^sha256:/);
    for (const strategy of report.strategies) {
      expect(strategy.cases.length).toBeGreaterThanOrEqual(30);
      expect(strategy.citationValidity).toBe(1);
      expect(strategy.recall5).toBeGreaterThanOrEqual(0);
      expect(strategy.recall5).toBeLessThanOrEqual(1);
    }
    const markdown = toMarkdown(report);
    expect(markdown).toContain('Recall@5');
    expect(markdown).toContain('截图识别检索题');
  });

  it('混合检索在固定测试集上不弱于关键词基线', async () => {
    const report = await evaluate({ fixtureFile: 'tests/fixtures/retrieval/test.json' });
    const keyword = report.strategies.find(item => item.strategy === 'keyword')!;
    const hybrid = report.strategies.find(item => item.strategy === 'hybrid')!;
    expect(hybrid.recall5).toBeGreaterThanOrEqual(keyword.recall5);
  });

  it('本地性能基准在目标时延内完成并单独记录本地 p50/p95', async () => {
    const bench = await benchmarkLocalRetrieval({ chunkCount: 600, dimensions: 256, warmupQueries: 3, measuredQueries: 8 });
    expect(bench.localP95Ms).toBeLessThanOrEqual(500);
    expect(bench.withinTarget).toBe(true);
  });

  it('本地合成向量对相同文本给出相同向量', async () => {
    const embed = syntheticEmbedding(64);
    const [a] = await embed(['递归终止条件']);
    const [b] = await embed(['递归终止条件']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });
});
