import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { JobStore } from '@/lib/verified-learning/jobs';
import { checkGenerationQuota, countGeneration } from '@/lib/verified-learning/quota';
import { ownTestDb } from './db-fixtures';

const A = 'a'.repeat(43);
const B = 'b'.repeat(43);
const now = new Date('2026-10-27T10:00:00.000Z');
async function setup() {
  const db = ownTestDb(new Database(':memory:'));
  await migrateVerifiedLearning(db);
  return db;
}
afterEach(() => vi.unstubAllEnvs());

describe('线上模式生成配额', () => {
  it('本地模式不限制', async () => {
    const db = await setup();
    const jobs = new JobStore(db);
    for (let i = 0; i < 8; i++) jobs.create(A, 'lesson', `k${i}`, { i });
    expect(() => checkGenerationQuota(db, A, now)).not.toThrow();
  });

  it('同一空间同时只能有一个生成任务', async () => {
    vi.stubEnv('VL_MODE', 'online');
    const db = await setup();
    const jobs = new JobStore(db);
    expect(() => checkGenerationQuota(db, A, now)).not.toThrow();
    jobs.create(A, 'curriculum', 'k1', {});
    expect(() => checkGenerationQuota(db, A, now)).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    // 导入任务不算生成
    expect(() => checkGenerationQuota(db, B, now)).not.toThrow();
  });

  it('每个空间每天最多 20 次，第二天重置', async () => {
    vi.stubEnv('VL_MODE', 'online');
    const db = await setup();
    for (let i = 0; i < 20; i++) countGeneration(db, A, now);
    expect(() => checkGenerationQuota(db, A, now)).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(() => checkGenerationQuota(db, A, new Date('2026-10-28T10:00:00.000Z'))).not.toThrow();
  });

  it('全站同时最多 6 个生成任务', async () => {
    vi.stubEnv('VL_MODE', 'online');
    const db = await setup();
    const jobs = new JobStore(db);
    for (let i = 0; i < 6; i++) jobs.create(String(i).repeat(43), 'lesson', `k${i}`, {});
    expect(() => checkGenerationQuota(db, B, now)).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});
