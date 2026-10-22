import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.useRealTimers());
import { migrateVerifiedLearning } from '@/lib/verified-learning/store';
import { JobStore } from '@/lib/verified-learning/jobs';
import { openTestDb, testDirectory } from './db-fixtures';

async function setup(filename = ':memory:') {
  const db = openTestDb(filename);
  await migrateVerifiedLearning(db);
  let time = new Date('2026-10-21T00:00:00.000Z');
  const now = () => new Date(time);
  const jobs = new JobStore(db, now);
  return { db, jobs, now, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
const conflict = expect.objectContaining({ code: 'VERSION_CONFLICT' });
const invalid = expect.objectContaining({ code: 'INVALID_INPUT' });
const missing = expect.objectContaining({ code: 'NOT_FOUND' });

async function running() {
  const context = await setup();
  const job = context.jobs.create('a', 'import', 'request-1', { textbookId: 'book-a' });
  const lease = context.jobs.claim('a', job.jobId)!;
  return { ...context, job, lease };
}

describe('持久化任务', () => {
  it('心跳停止后租约过期可人工恢复，取消任务不会被心跳复活', async () => {
    const { jobs, job, lease, advance } = await running();
    vi.useFakeTimers();
    const stop = jobs.keepAlive('a', job.jobId, lease);
    advance(30000); await vi.advanceTimersByTimeAsync(30000);
    stop(); advance(90001);
    expect(jobs.get('a', job.jobId).resumable).toBe(true);
    jobs.resume('a', job.jobId);
    const nextLease = jobs.claim('a', job.jobId)!;
    jobs.keepAlive('a', job.jobId, nextLease);
    jobs.cancel('a', job.jobId);
    advance(30000); await vi.advanceTimersByTimeAsync(30000);
    expect(jobs.get('a', job.jobId).status).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('规范化请求顺序后幂等，异内容冲突，scope/kind 独立', async () => {
    const { jobs } = await setup();
    const first = jobs.create('a', 'import', 'key', { nested: { a: 1, b: 2 } });
    expect(jobs.create('a', 'import', 'key', { nested: { b: 2, a: 1 } })).toEqual(first);
    expect(() => jobs.create('a', 'import', 'key', { nested: { a: 2 } })).toThrow(conflict);
    expect(jobs.create('b', 'import', 'key', {}).jobId).not.toBe(first.jobId);
    expect(jobs.create('a', 'lesson', 'key', {}).jobId).not.toBe(first.jobId);
    expect(first).toMatchObject({ status: 'queued', attempts: 0, eventCursor: 1, result: null, error: null, resumable: false });
    expect(jobs.events('a', first.jobId, 0)).toHaveLength(1);
  });

  it('无效输入、循环和非 JSON 不能产生任务', async () => {
    const { db, jobs } = await setup();
    const circular: { loop?: unknown } = {};
    circular.loop = circular;
    for (const input of [undefined, NaN, () => 1, { missing: undefined }, circular, new Date()]) {
      expect(() => jobs.create('a', 'import', 'key', input)).toThrow(invalid);
    }
    expect(() => jobs.create(' ', 'import', 'key', {})).toThrow(invalid);
    expect(() => jobs.create('a', 'unknown' as never, 'key', {})).toThrow(invalid);
    expect(db.prepare('SELECT count(*) AS n FROM vl_jobs').get()).toEqual({ n: 0 });
  });

  it('跨 scope 的读取、领取、恢复、取消、写入都隐藏存在性', async () => {
    const { jobs, job, lease } = await running();
    const calls = [
      () => jobs.get('b', job.jobId), () => jobs.getWork('b', job.jobId),
      () => jobs.claim('b', job.jobId), () => jobs.resume('b', job.jobId),
      () => jobs.cancel('b', job.jobId), () => jobs.events('b', job.jobId, 0),
      () => jobs.checkpoint('b', job.jobId, lease, 'parsed', {}),
      () => jobs.finish('b', job.jobId, lease, 'succeeded', { kind: 'book', id: 'book-a' }, null),
    ];
    for (const call of calls) expect(call).toThrow(missing);
    expect(jobs.list('b')).toEqual([]);
  });

  it('领取只接受 queued，读取与事件回放没有写入', async () => {
    const { jobs } = await setup();
    const job = jobs.create('a', 'import', 'key', { secret: '后台数据' });
    const lease = jobs.claim('a', job.jobId);
    expect(lease).toEqual(expect.any(String));
    expect(jobs.claim('a', job.jobId)).toBeNull();
    const view = jobs.get('a', job.jobId);
    expect(view).toMatchObject({ status: 'running', attempts: 1, eventCursor: 2 });
    expect(JSON.stringify(view)).not.toContain('后台数据');
    expect(JSON.stringify(view)).not.toContain(lease!);
    expect(jobs.events('a', job.jobId, 1)).toHaveLength(1);
    expect(jobs.get('a', job.jobId)).toEqual(view);
  });

  it('另一连接不能重复领取相同任务', async () => {
    const filename = path.join(testDirectory(), 'jobs.db');
    const { jobs, now } = await setup(filename);
    const second = new JobStore(openTestDb(filename), now);
    const job = jobs.create('a', 'lesson', 'key', {});
    expect(jobs.claim('a', job.jobId)).not.toBeNull();
    expect(second.claim('a', job.jobId)).toBeNull();
    expect(second.get('a', job.jobId).attempts).toBe(1);
  });

  it('过期任务只显示可恢复，显式恢复后旧 lease 不能写入', async () => {
    const { jobs, job, lease, advance } = await running();
    jobs.checkpoint('a', job.jobId, lease, 'parsed', { attempts: { parse: 1 }, text: '固定结果' });
    advance(90_000);
    const before = jobs.events('a', job.jobId, 0);
    expect(jobs.get('a', job.jobId)).toMatchObject({ status: 'running', resumable: true });
    expect(jobs.claim('a', job.jobId)).toBeNull();
    expect(jobs.events('a', job.jobId, 0)).toEqual(before);
    expect(() => jobs.checkpoint('a', job.jobId, lease, 'late', {})).toThrow(conflict);
    expect(jobs.resume('a', job.jobId).status).toBe('queued');
    const next = jobs.claim('a', job.jobId)!;
    expect(next).not.toBe(lease);
    expect(jobs.getWork('a', job.jobId)).toMatchObject({ checkpoint: { attempts: { parse: 1 }, text: '固定结果' } });
    expect(jobs.get('a', job.jobId).attempts).toBe(2);
    expect(() => jobs.finish('a', job.jobId, lease, 'succeeded', { kind: 'book', id: 'late' }, null)).toThrow(conflict);
  });

  it('活动 lease 不允许恢复，取消之后拒绝迟到结果', async () => {
    const { jobs, job, lease } = await running();
    expect(() => jobs.resume('a', job.jobId)).toThrow(conflict);
    const cancelled = jobs.cancel('a', job.jobId);
    expect(cancelled.status).toBe('cancelled');
    expect(jobs.cancel('a', job.jobId)).toEqual(cancelled);
    expect(() => jobs.finish('a', job.jobId, lease, 'succeeded', { kind: 'book', id: 'book-a' }, null)).toThrow(conflict);
    expect(() => jobs.resume('a', job.jobId)).toThrow(conflict);
  });

  it('失败按 retryable 显式恢复，预算检查点不会重置', async () => {
    const { jobs, job, lease } = await running();
    jobs.checkpoint('a', job.jobId, lease, 'provider', { calls: 3 });
    jobs.finish('a', job.jobId, lease, 'failed', null, { code: 'PROVIDER_ERROR', message: '服务不可用', retryable: true });
    expect(jobs.get('a', job.jobId).resumable).toBe(true);
    jobs.resume('a', job.jobId);
    expect(jobs.getWork('a', job.jobId).checkpoint).toEqual({ calls: 3 });
    const next = jobs.claim('a', job.jobId)!;
    jobs.finish('a', job.jobId, next, 'failed', null, { code: 'LIMIT_EXCEEDED', message: '预算耗尽', retryable: false });
    expect(jobs.get('a', job.jobId).resumable).toBe(false);
    expect(() => jobs.resume('a', job.jobId)).toThrow(conflict);
  });

  it('有结果等待确认不能重新运行，已完成不可取消', async () => {
    const { jobs, job, lease } = await running();
    jobs.finish('a', job.jobId, lease, 'waiting_user', { kind: 'course', id: 'course-a', versionId: 'v1' }, null);
    expect(jobs.get('a', job.jobId).resumable).toBe(false);
    expect(() => jobs.resume('a', job.jobId)).toThrow(conflict);
    const other = jobs.create('a', 'import', 'other', {});
    const otherLease = jobs.claim('a', other.jobId)!;
    jobs.finish('a', other.jobId, otherLease, 'succeeded', { kind: 'book', id: 'book-b' }, null);
    expect(() => jobs.cancel('a', other.jobId)).toThrow(conflict);
  });

  it('未知外部结果需要用户恢复，读取不自动重排', async () => {
    const { jobs, job, lease } = await running();
    jobs.finish('a', job.jobId, lease, 'waiting_user', null, { code: 'PROVIDER_ERROR', message: '提交结果未知', retryable: true });
    const view = jobs.get('a', job.jobId);
    expect(view).toMatchObject({ status: 'waiting_user', resumable: true });
    expect(jobs.get('a', job.jobId)).toEqual(view);
    expect(jobs.resume('a', job.jobId).status).toBe('queued');
  });

  it('事件插入失败回滚任务创建与领取', async () => {
    const { db, jobs } = await setup();
    db.exec("CREATE TRIGGER reject_jobs BEFORE INSERT ON vl_job_events BEGIN SELECT RAISE(ABORT,'拒绝事件'); END");
    expect(() => jobs.create('a', 'import', 'key', {})).toThrow('拒绝事件');
    expect(db.prepare('SELECT count(*) AS n FROM vl_jobs').get()).toEqual({ n: 0 });
    db.exec('DROP TRIGGER reject_jobs');
    const job = jobs.create('a', 'import', 'key', {});
    db.exec("CREATE TRIGGER reject_jobs BEFORE INSERT ON vl_job_events BEGIN SELECT RAISE(ABORT,'拒绝事件'); END");
    expect(() => jobs.claim('a', job.jobId)).toThrow('拒绝事件');
    expect(jobs.get('a', job.jobId)).toEqual(job);
  });

  it('检查点与最终结果不合法时不改变事件或进度', async () => {
    const { jobs, job, lease } = await running();
    const before = jobs.get('a', job.jobId);
    expect(() => jobs.checkpoint('a', job.jobId, lease, 'parsed', { fn: () => 1 })).toThrow(invalid);
    expect(() => jobs.finish('a', job.jobId, lease, 'running' as never, null, null)).toThrow(invalid);
    expect(() => jobs.finish('a', job.jobId, lease, 'succeeded', { kind: 'book', id: ' ' }, null)).toThrow(invalid);
    expect(() => jobs.finish('a', job.jobId, lease, 'succeeded', null, null)).toThrow(invalid);
    expect(jobs.get('a', job.jobId)).toEqual(before);
  });

  it('重开恢复固定结果，返回值不能修改已存数据', async () => {
    const filename = path.join(testDirectory(), 'jobs.db');
    const { db, jobs, now } = await setup(filename);
    const job = jobs.create('a', 'import', 'key', { values: [1] });
    const lease = jobs.claim('a', job.jobId)!;
    jobs.checkpoint('a', job.jobId, lease, 'parsed', { count: 1 });
    const view = jobs.finish('a', job.jobId, lease, 'succeeded', { kind: 'book', id: 'book-a' }, null);
    view.result!.id = 'mutated';
    db.close();
    const reopened = new JobStore(openTestDb(filename), now);
    expect(reopened.get('a', job.jobId).result).toEqual({ kind: 'book', id: 'book-a' });
    expect(reopened.create('a', 'import', 'key', { values: [1] }).status).toBe('succeeded');
  });

  it('列表只返回当前 scope 最近50项，cursor 必须有效', async () => {
    const { jobs, advance } = await setup();
    for (let index = 0; index < 52; index++) {
      jobs.create('a', 'import', `key-${index}`, {});
      advance(1);
    }
    jobs.create('b', 'import', 'foreign', {});
    const list = jobs.list('a');
    expect(list).toHaveLength(50);
    expect(jobs.getWork('a', list[0].jobId).input).toEqual({});
    expect(() => jobs.events('a', list[0].jobId, -1)).toThrow(invalid);
  });
});
