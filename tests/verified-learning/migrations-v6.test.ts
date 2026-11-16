import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { ownTestDb } from './db-fixtures';

const tableNames = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);

describe('schema v6：检索派生索引', () => {
  it('迁移后创建检索块、向量和索引任务表', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(6);
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);

    expect(db.prepare('SELECT version FROM vl_schema_migrations ORDER BY version').all().map(row => (row as { version: number }).version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tableNames(db)).toEqual(expect.arrayContaining(['vl_retrieval_chunks', 'vl_retrieval_vectors', 'vl_index_jobs']));
  });

  it('同一来源修订和 profile 不能有两个活跃索引任务，不同 profile 可以并存', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision','{"chapters":[]}','t')`).run();
    const row = ['scope', 'job-1', 'book', 'revision', 'profile', 'key-1'];
    const insert = db.prepare(`INSERT INTO vl_index_jobs
      (scope_id,job_id,book_id,source_revision,profile_id,idempotency_key,status,progress_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'queued','{}',?,?)`);
    insert.run(...row, '2026-11-17', '2026-11-17');
    expect(() => insert.run('scope', 'job-2', 'book', 'revision', 'profile', 'key-2', '2026-11-17', '2026-11-17')).toThrow(/UNIQUE|constraint/i);
    insert.run('scope', 'job-3', 'book', 'revision', 'profile-2', 'job-3', '2026-11-17', '2026-11-17');
    expect(db.prepare('SELECT count(*) AS count FROM vl_index_jobs').get()).toEqual({ count: 2 });
  });

  it('向量表保存维度、状态和错误码', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision','{"chapters":[]}','t')`).run();
    db.prepare(`INSERT INTO vl_retrieval_chunks(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version)
      VALUES ('scope','book','revision','chapter',0,0,'text','hash','v1')`).run();
    expect(() => db.prepare(`INSERT INTO vl_retrieval_vectors(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,error_code,updated_at)
      VALUES ('scope','book','revision','chapter',0,0,'profile',3,NULL,'ready',NULL,'t')`).run()).toThrow(/CHECK/i);
    db.prepare(`INSERT INTO vl_retrieval_vectors(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,error_code,updated_at)
      VALUES ('scope','book','revision','chapter',0,0,'profile',3,NULL,'failed','DIMENSION_MISMATCH','t')`).run();
    expect(db.prepare('SELECT status,error_code,dimensions FROM vl_retrieval_vectors').get()).toEqual({ status: 'failed', error_code: 'DIMENSION_MISMATCH', dimensions: 3 });
  });

  it('失败向量可以没有 BLOB，就绪向量必须有 BLOB', async () => {
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('scope','book','owned','ready','t')`).run();
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('scope','book','revision','{"chapters":[]}','t')`).run();
    db.prepare(`INSERT INTO vl_retrieval_chunks(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version)
      VALUES ('scope','book','revision','chapter',0,0,'text','hash','v1')`).run();
    const insert = db.prepare(`INSERT INTO vl_retrieval_vectors(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,updated_at)
      VALUES ('scope','book','revision','chapter',0,0,'profile',3,?,?,?)`);
    expect(() => insert.run(null, 'ready', 't')).toThrow(/CHECK/i);
    insert.run(null, 'failed', 't');
    const update = db.prepare(`UPDATE vl_retrieval_vectors SET status='ready',vector_blob=? WHERE profile_id='profile'`);
    expect(() => update.run(Buffer.alloc(4))).toThrow(/CHECK/i);
    update.run(Buffer.alloc(12));
    expect((db.prepare("SELECT status FROM vl_retrieval_vectors WHERE profile_id='profile'").get() as { status: string }).status).toBe('ready');
  });
});
