import type Database from 'better-sqlite3';
import { fail } from './http';
import { JobStore, type JobView } from './jobs';
import { randomUUID } from 'node:crypto';

/**
 * 任务事件流（规格 8.1）：Server-Sent Events。
 * - 每秒读取新事件推送；状态变化时推送 job 快照；15 秒无事件发心跳注释。
 * - 任务终态且事件读尽后推送 end 并关闭。
 * - 客户端断开（signal 中止）后停止查询并关闭数据库连接。
 * 推送内容只有事件文本与 JobView（与 GET /jobs/{id} 相同），不含 Key。
 */
const TERMINAL = new Set(['waiting_user', 'succeeded', 'failed', 'cancelled']);
const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;

export function jobStreamResponse(open: () => Database.Database, scope: string, jobId: string, after: number, signal: AbortSignal): Response {
  // 先确认任务属于该空间，否则返回普通错误信封
  const probe = open();
  try { new JobStore(probe).get(scope, jobId); }
  catch (error) { return fail(error, randomUUID()); }
  finally { probe.close(); }

  const encoder = new TextEncoder();
  let cursor = Number.isSafeInteger(after) && after > 0 ? after : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let lastSent = Date.now();
  let lastJob = '';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const db = open();
      const jobs = new JobStore(db);
      const send = (text: string) => { controller.enqueue(encoder.encode(text)); lastSent = Date.now(); };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', close);
        db.close();
        try { controller.close(); } catch { /* 已关闭 */ }
      };
      signal.addEventListener('abort', close, { once: true });
      // 告诉浏览器断线 2 秒后重连（携带 Last-Event-ID）
      send('retry: 2000\n\n');

      const tick = () => {
        if (closed) return;
        try {
          for (;;) {
            const batch = jobs.events(scope, jobId, cursor);
            for (const event of batch) {
              send(`id: ${event.cursor}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`);
              cursor = event.cursor;
            }
            if (batch.length < 100) break;
          }
          const job: JobView = jobs.get(scope, jobId);
          const snapshot = JSON.stringify(job);
          if (snapshot !== lastJob) { send(`event: job\ndata: ${snapshot}\n\n`); lastJob = snapshot; }
          if (TERMINAL.has(job.status) && cursor >= job.eventCursor) {
            send('event: end\ndata: {}\n\n');
            close();
            return;
          }
          if (Date.now() - lastSent >= HEARTBEAT_MS) send(': ping\n\n');
        } catch {
          send('event: error\ndata: {"message":"读取任务进度失败，正在重试"}\n\n');
        }
        timer = setTimeout(tick, POLL_MS);
      };
      tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    },
  });
}
