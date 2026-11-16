import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { createRetrievalService } from '@/lib/verified-learning/retrieval/service';
import { indexSource } from '@/lib/verified-learning/retrieval/indexer';
import { createEmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import type { SourceSnapshot } from '@/lib/verified-learning/sources';
import { ownTestDb } from './db-fixtures';

const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'embed', dimensions: 2 }, 'v1');
const source: SourceSnapshot = {
  sourceId: 'book', sourceRevision: 'revision', title: '教材', format: 'txt',
  chapters: [{ chapterId: 'chapter', title: '章节', paragraphs: [
    { paragraphIndex: 0, text: '循环必须写明退出条件。', contentHash: 'h0' },
    { paragraphIndex: 1, text: '递归需要终止条件，否则会栈溢出。', contentHash: 'h1' },
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
});
