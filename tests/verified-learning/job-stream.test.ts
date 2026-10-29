import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { JobStore } from '@/lib/verified-learning/jobs';
import { jobStreamResponse } from '@/lib/verified-learning/job-stream';
import { ownTestDb, testDirectory } from './db-fixtures';
import path from 'node:path';

/** 读取 SSE 正文直到结束或超时 */
async function readAll(response: Response, timeoutMs = 4000): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value?: undefined }>(r => setTimeout(() => r({ done: true }), deadline - Date.now()))]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  await reader.cancel().catch(() => undefined);
  return text;
}
function events(text: string) {
  return text.split('\n\n').filter(Boolean).filter(block => !block.startsWith(':')).map(block => {
    const lines = block.split('\n');
    return {
      id: lines.find(l => l.startsWith('id: '))?.slice(4),
      event: lines.find(l => l.startsWith('event: '))?.slice(7),
      data: JSON.parse(lines.find(l => l.startsWith('data: '))?.slice(6) ?? 'null'),
    };
  });
}

async function fileDb() {
  const filename = path.join(testDirectory(), 'stream.db');
  const db = ownTestDb(new Database(filename));
  db.pragma('journal_mode = WAL');
  await migrateVerifiedLearning(db);
  return { db, open: () => ownTestDb(new Database(filename)) };
}
afterEach(() => vi.useRealTimers());

describe('任务事件 SSE 流', () => {
  it('已结束的任务立即推送全部历史事件和 end，然后关闭', async () => {
    const { db, open } = await fileDb();
    const jobs = new JobStore(db);
    const job = jobs.create('s', 'lesson', 'k', {});
    const lease = jobs.claim('s', job.jobId)!;
    jobs.finish('s', job.jobId, lease, 'succeeded', { kind: 'lesson', id: 'run-1' }, null);
    const started = Date.now();
    const response = jobStreamResponse(open, 's', job.jobId, 0, new AbortController().signal);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const list = events(await readAll(response));
    expect(Date.now() - started).toBeLessThan(2000);
    const progress = list.filter(e => e.event === 'progress');
    expect(progress.map(e => e.data.message)).toEqual(['任务已排队', '任务开始执行', '任务已完成']);
    expect(progress.map(e => e.id)).toEqual(['1', '2', '3']);
    expect(list.some(e => e.event === 'job' && e.data.status === 'succeeded')).toBe(true);
    expect(list.at(-1)?.event).toBe('end');
  });

  it('从指定游标之后续传', async () => {
    const { db, open } = await fileDb();
    const jobs = new JobStore(db);
    const job = jobs.create('s', 'lesson', 'k', {});
    const lease = jobs.claim('s', job.jobId)!;
    jobs.finish('s', job.jobId, lease, 'succeeded', { kind: 'lesson', id: 'run-1' }, null);
    const list = events(await readAll(jobStreamResponse(open, 's', job.jobId, 2, new AbortController().signal)));
    expect(list.filter(e => e.event === 'progress').map(e => e.id)).toEqual(['3']);
  });

  it('运行中追加的事件在 1.5 秒内推出；中止后停止查询', async () => {
    const { db, open } = await fileDb();
    const jobs = new JobStore(db);
    const job = jobs.create('s', 'lesson', 'k', {});
    jobs.claim('s', job.jobId);
    const controller = new AbortController();
    const response = jobStreamResponse(open, 's', job.jobId, 0, controller.signal);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pump = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value); } })();
    await new Promise(r => setTimeout(r, 300));
    db.transaction(() => {
      db.prepare('UPDATE vl_jobs SET event_cursor=event_cursor+1 WHERE scope_id=? AND job_id=?').run('s', job.jobId);
      db.prepare("INSERT INTO vl_job_events SELECT scope_id,job_id,event_cursor,'lesson','Agent：读取原文',? FROM vl_jobs WHERE scope_id=? AND job_id=?").run(new Date().toISOString(), 's', job.jobId);
    })();
    await new Promise(r => setTimeout(r, 1500));
    expect(text).toContain('Agent：读取原文');
    controller.abort();
    await pump.catch(() => undefined);
    const lengthAfterAbort = text.length;
    await new Promise(r => setTimeout(r, 1200));
    expect(text.length).toBe(lengthAfterAbort);
  });

  it('读取方取消流（未触发请求中止）时也关闭流内的数据库连接', async () => {
    const { db, open } = await fileDb();
    const jobs = new JobStore(db);
    const job = jobs.create('s', 'lesson', 'k', {});
    jobs.claim('s', job.jobId);
    const handles: Database.Database[] = [];
    const tracked = () => { const handle = open(); handles.push(handle); return handle; };
    const response = jobStreamResponse(tracked, 's', job.jobId, 0, new AbortController().signal);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    // 第一个是归属检查用的连接，第二个是流内连接
    expect(handles).toHaveLength(2);
    expect(handles.map(h => h.open)).toEqual([false, false]);
  });

  it('其他空间的任务返回 404 信封而不是流', async () => {
    const { db, open } = await fileDb();
    const job = new JobStore(db).create('s', 'lesson', 'k', {});
    const response = jobStreamResponse(open, 'other', job.jobId, 0, new AbortController().signal);
    expect(response.status).toBe(404);
  });
});
