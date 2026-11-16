import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createEmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import { indexSource } from '@/lib/verified-learning/retrieval/indexer';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import type { SourceSnapshot } from '@/lib/verified-learning/sources';
import { ownTestDb } from './db-fixtures';

const source: SourceSnapshot = {
  sourceId: 'book', sourceRevision: 'revision', title: '教材', format: 'txt',
  chapters: [{ chapterId: 'chapter', title: '章节', paragraphs: [{ paragraphIndex: 0, text: '递归需要终止条件。', contentHash: 'hash' }] }],
};
const config = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'embed', dimensions: 3 }, 'v1');

describe('Embedding 索引器', () => {
  it('成功保存向量并可重复运行而不重复写块', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision',?,'t')`).run(JSON.stringify(source));
    let calls = 0;
    const summary = await indexSource(db, 'scope', source, config, { embed: async texts => { calls++; return texts.map(() => [1, 0, 0]); } });
    expect(summary.ready).toBe(1);
    expect(calls).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM vl_retrieval_chunks').get() as { count: number }).count).toBe(1);
    await indexSource(db, 'scope', source, config, { embed: async texts => { calls++; return texts.map(() => [1, 0, 0]); } });
    expect(calls).toBe(1);
  });

  it('Embedding 失败时保留块并记录失败状态', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision',?,'t')`).run(JSON.stringify(source));
    const summary = await indexSource(db, 'scope', source, config, { embed: async () => { throw new Error('timeout'); } });
    expect(summary.failed).toBe(1);
    expect((db.prepare('SELECT status,error_code FROM vl_retrieval_vectors').get())).toEqual({ status: 'failed', error_code: 'EMBEDDING_FAILED' });
    expect((db.prepare('SELECT count(*) AS count FROM vl_retrieval_chunks').get() as { count: number }).count).toBe(1);
  });
});
