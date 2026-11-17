import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { createRetrievalService } from '@/lib/verified-learning/retrieval/service';
import { indexSource } from '@/lib/verified-learning/retrieval/indexer';
import { createEmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import { checkCitation, contentHash, type SourceSnapshot } from '@/lib/verified-learning/sources';
import { ownTestDb } from './db-fixtures';

const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'embed', dimensions: 2 }, 'v1');
const source: SourceSnapshot = {
  sourceId: 'book', sourceRevision: 'revision', title: '教材', format: 'txt',
  chapters: [{ chapterId: 'chapter', title: '章节', paragraphs: [
    { paragraphIndex: 0, text: '循环必须写明退出条件。', contentHash: contentHash('循环必须写明退出条件。') },
    { paragraphIndex: 1, text: '递归需要终止条件，否则会栈溢出。', contentHash: contentHash('递归需要终止条件，否则会栈溢出。') },
  ]}],
};

async function indexed(): Promise<Database.Database> {
  const db = ownTestDb(new Database(':memory:'));
  await migrateVerifiedLearning(db);
  db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
  db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision',?,'t')`).run(JSON.stringify(source));
  await indexSource(db, 'scope', source, profile, { embed: async values => values.map(value => (value.includes('递归') ? [1, 0] : [0, 1])) });
  return db;
}

describe('检索服务', () => {
  it('关键词命中并保留真实段号', async () => {
    const db = await indexed();
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => [[0, 1]] });
    const result = await service.retrieve('递归 终止', [source]);
    expect(result.hits[0]).toMatchObject({ sourceId: 'book', sourceRevision: 'revision', chapterId: 'chapter', paragraphIndex: 1 });
    expect(result.degraded).toBe(false);
    db.close();
  });

  it('Embedding 查询失败时降级关键词检索', async () => {
    const db = await indexed();
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => { throw new Error('timeout'); } });
    const result = await service.retrieve('递归 终止', [source]);
    expect(result.degraded).toBe(true);
    expect(result.hits.map(hit => hit.paragraphIndex)).toContain(1);
    db.close();
  });

  it('只检索请求的来源版本，不返回其他资料', async () => {
    const db = await indexed();
    const other = { ...source, sourceId: 'other-book', sourceRevision: 'other-revision' };
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => [[1, 0]] });
    expect(await service.retrieve('递归', [other])).toEqual({ hits: [], degraded: false, keywordCount: 0, vectorCount: 0 });
    db.close();
  });

  it('按章节过滤并拒绝超长查询', async () => {
    const db = await indexed();
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => [[1, 0]] });
    expect(await service.retrieve('递归', [source], { chapterIds: ['missing'] })).toMatchObject({ hits: [] });
    await expect(service.retrieve('x'.repeat(500), [source])).rejects.toThrow(/查询过长/);
    db.close();
  });

  it('没有 Embedding 配置时使用关键词检索', async () => {
    const db = await indexed();
    const service = createRetrievalService(db, 'scope');
    const result = await service.retrieve('递归 终止', [source]);
    expect(result.degraded).toBe(false);
    expect(result.vectorCount).toBe(0);
    expect(result.hits[0].paragraphIndex).toBe(1);
    db.close();
  });

  it('未建立向量索引的教材与新拉取的 web 来源仍可通过关键词检索命中且不触发建库', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    const webSource: SourceSnapshot = {
      sourceId: 'web:abc', sourceRevision: 'rev-web', title: 'https://docs.python.org/zh-cn/3/', format: 'txt',
      chapters: [{ chapterId: 'web', title: '公开网页正文', paragraphs: [
        { paragraphIndex: 0, text: '尾递归优化在标准 Python 解释器中并未启用。', contentHash: contentHash('尾递归优化在标准 Python 解释器中并未启用。') },
      ]}],
    };
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t'),('scope','web:abc','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision',?,'t'),('scope','web:abc','rev-web',?,'t')`)
      .run(JSON.stringify(source), JSON.stringify(webSource));
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => [[1, 0]] });
    const result = await service.retrieve('尾递归优化', [source, webSource]);
    expect(result.hits.some(hit => hit.sourceId === 'web:abc' && hit.paragraphIndex === 0)).toBe(true);
    expect((db.prepare('SELECT count(*) AS n FROM vl_retrieval_chunks').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('长段切块重叠后返回快照原始段落正文，100% 通过 checkCitation', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    const longText = `${'递归调用必须收敛到终止条件，否则调用栈会持续增长。'.repeat(30)}${'利用记忆化缓存可以消除重复子问题计算。'.repeat(25)}`;
    const longSource: SourceSnapshot = {
      sourceId: 'long-book', sourceRevision: 'rev-1', title: '算法讲义', format: 'txt',
      chapters: [{ chapterId: 'ch1', title: '分治与递归', paragraphs: [{ paragraphIndex: 7, text: longText, contentHash: contentHash(longText) }] }],
    };
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','long-book','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','long-book','rev-1',?,'t')`).run(JSON.stringify(longSource));
    await indexSource(db, 'scope', longSource, profile, { embed: async values => values.map(() => [1, 0]) });
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => [[1, 0]] });
    const result = await service.retrieve('记忆化缓存消除重复子问题', [longSource]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].text).toBe(longText);
    expect(checkCitation([longSource], {
      sourceId: 'long-book', sourceRevision: 'rev-1', chapterId: 'ch1', paragraphIndex: 7, quote: result.hits[0].text.slice(480, 560),
    }).ok).toBe(true);
    db.close();
  });

  it('已撤销的来源版本不可召回，向量维度异常时忽略并标记 stale', async () => {
    const db = await indexed();
    const service = createRetrievalService(db, 'scope', { profile, embed: async () => [[1, 0, 0]] });
    // 查询返回 3 维而索引是 2 维：忽略异常向量并标 stale，关键词结果仍返回
    const mismatch = await service.retrieve('递归', [source]);
    expect(mismatch.hits[0]?.paragraphIndex).toBe(1);
    const statuses = db.prepare("SELECT status FROM vl_retrieval_vectors WHERE scope_id='scope'").all() as { status: string }[];
    expect(statuses.every(s => s.status === 'stale')).toBe(true);

    // 撤销来源修订后立即失效
    db.prepare("UPDATE vl_source_revisions SET revoked_at='2026-11-17T00:00:00Z' WHERE scope_id='scope' AND book_id='book'").run();
    const afterRevoke = await service.retrieve('递归', [source]);
    expect(afterRevoke.hits).toEqual([]);
    db.close();
  });
});
