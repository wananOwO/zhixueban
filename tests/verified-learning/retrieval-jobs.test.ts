import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { IndexJobStore } from '@/lib/verified-learning/retrieval/store';
import { createEmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import type { SourceSnapshot } from '@/lib/verified-learning/sources';
import { ownTestDb } from './db-fixtures';

const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'embed' }, 'v1');
const source: SourceSnapshot = {
  sourceId: 'book', sourceRevision: 'revision', title: '教材', format: 'txt',
  chapters: [{ chapterId: 'chapter', title: '章节', paragraphs: [
    { paragraphIndex: 0, text: '第一段。', contentHash: 'h0' },
    { paragraphIndex: 1, text: '第二段。', contentHash: 'h1' },
  ]}],
};

async function fresh() {
  const db = ownTestDb(new Database(':memory:'));
  await migrateVerifiedLearning(db);
  db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
  db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision',?,'t')`).run(JSON.stringify(source));
  return { db, store: new IndexJobStore(db) };
}

describe('索引任务', () => {
  it('幂等：同一 key 重复请求返回同一任务，不同 key 在活动期冲突', async () => {
    const { db, store } = await fresh();
    const first = store.create({ scopeId: 'scope', key: 'k1', source, profile });
    expect(store.create({ scopeId: 'scope', key: 'k1', source, profile })).toEqual(first);
    expect(() => store.create({ scopeId: 'scope', key: 'k2', source, profile })).toThrow(expect.objectContaining({ code: 'IN_PROGRESS' }));
    db.close();
  });

  it('运行任务写入向量与进度统计，成功后状态为 succeeded', async () => {
    const { db, store } = await fresh();
    const job = store.create({ scopeId: 'scope', key: 'k1', source, profile });
    await store.run({ scopeId: 'scope', jobId: job.jobId, source, profile }, { embed: async values => values.map(() => [1, 0]) });
    expect(store.get('scope', job.jobId).status).toBe('succeeded');
    expect(store.status('scope', 'book', 'revision', profile.profileId)).toMatchObject({ ready: 2, failed: 0, total: 2, status: 'succeeded', usable: true });
    expect(JSON.stringify(db.prepare('SELECT * FROM vl_index_jobs').all())).not.toContain('sk-');
    db.close();
  });

  it('全局失败时任务 failed 且可恢复，错误文本不含供应商原文', async () => {
    const { db, store } = await fresh();
    const job = store.create({ scopeId: 'scope', key: 'k1', source, profile });
    await store.run({ scopeId: 'scope', jobId: job.jobId, source, profile }, { embed: async () => { throw new Error('Incorrect API key provided: sk-real-secret'); } });
    const view = store.get('scope', job.jobId);
    expect(view.status).toBe('failed');
    expect(view.resumable).toBe(true);
    expect(view.error?.message).not.toContain('sk-real-secret');
    expect(JSON.stringify(store.get('scope', job.jobId))).not.toContain('sk-real-secret');
    expect(store.status('scope', 'book', 'revision', profile.profileId)).toMatchObject({ failed: 2, usable: false });
    db.close();
  });

  it('取消后不再写入向量', async () => {
    const { db, store } = await fresh();
    const job = store.create({ scopeId: 'scope', key: 'k1', source, profile });
    store.cancel('scope', job.jobId);
    expect(store.get('scope', job.jobId).status).toBe('cancelled');
    let started = false;
    await store.run({ scopeId: 'scope', jobId: job.jobId, source, profile }, { embed: async values => { started = true; return values.map(() => [1, 0]); } });
    expect(started).toBe(false);
    expect((db.prepare("SELECT count(*) AS n FROM vl_retrieval_vectors WHERE scope_id='scope'").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('恢复后跳过已就绪向量，不重复请求', async () => {
    const { db, store } = await fresh();
    const job = store.create({ scopeId: 'scope', key: 'k1', source, profile });
    await store.run({ scopeId: 'scope', jobId: job.jobId, source, profile }, { embed: async values => values.map(() => [1, 0]) });
    const before = (db.prepare("SELECT count(*) AS n FROM vl_retrieval_vectors WHERE status='ready'").get() as { n: number }).n;
    let calls = 0;
    await store.run({ scopeId: 'scope', jobId: job.jobId, source, profile }, { embed: async values => { calls++; return values.map(() => [1, 0]); } });
    expect(calls).toBe(0);
    expect(before).toBe(2);
    db.close();
  });

  it('跨空间读取返回不存在', async () => {
    const { db, store } = await fresh();
    const job = store.create({ scopeId: 'scope', key: 'k1', source, profile });
    expect(() => store.get('other', job.jobId)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    db.close();
  });
});