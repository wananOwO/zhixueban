import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LearningError } from './contracts';

const id = z.string().min(1).max(512).refine(value => value.trim().length > 0);
const kindSchema = z.enum(['import', 'curriculum', 'lesson', 'question_set', 'assessment']);
const resultSchema = z.strictObject({
  kind: z.enum(['book', 'course', 'lesson', 'question_set', 'attempt']),
  id, versionId: id.optional(),
});
const errorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z_]+$/).max(80),
  message: z.string().min(1), retryable: z.boolean(),
});
export type JobKind = z.infer<typeof kindSchema>;
export type JobResult = z.infer<typeof resultSchema>;
export type JobError = z.infer<typeof errorSchema>;
export type JobStatus = 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
export interface JobView {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  stage: string;
  eventCursor: number;
  attempts: number;
  result: JobResult | null;
  error: JobError | null;
  resumable: boolean;
}
export interface JobEvent { cursor: number; stage: string; message: string; createdAt: string }
interface JobRow {
  scope_id: string; job_id: string; kind: JobKind; input_json: string;
  status: JobStatus; stage: string; attempts: number; event_cursor: number;
  lease_token: string | null; lease_until: string | null;
  checkpoint_json: string | null; result_json: string | null; error_json: string | null;
}
const LEASE_MS = 90_000;

function invalid(): never {
  throw new LearningError('INVALID_INPUT', '任务输入不合法');
}
function conflict(): never {
  throw new LearningError('VERSION_CONFLICT', '任务状态已变化，请重新读取');
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) invalid();
  return result.data;
}
function canonicalJson(input: unknown): string {
  const active = new Set<object>();
  let nodes = 0;
  function encode(value: unknown, depth: number): string {
    if (++nodes > 100_000 || depth > 64) invalid();
    if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
    if (!value || typeof value !== 'object' || active.has(value)) invalid();
    active.add(value);
    let serialized: string;
    if (Array.isArray(value)) {
      serialized = `[${Array.from(value, item => encode(item, depth + 1)).join(',')}]`;
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) invalid();
      serialized = `{${Object.keys(value).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) invalid();
        return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    }
    active.delete(value);
    return serialized;
  }
  const result = encode(input, 0);
  if (Buffer.byteLength(result) > 4 * 1024 * 1024) invalid();
  return result;
}

export class JobStore {
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {}

  private row(scopeId: string, jobId: string): JobRow {
    parse(id, scopeId);
    parse(id, jobId);
    const row = this.db.prepare('SELECT * FROM vl_jobs WHERE scope_id=? AND job_id=?').get(scopeId, jobId) as JobRow | undefined;
    if (!row) throw new LearningError('NOT_FOUND', '任务不存在');
    return row;
  }

  private view(row: JobRow): JobView {
    const result: JobResult | null = row.result_json === null ? null : JSON.parse(row.result_json);
    const error: JobError | null = row.error_json === null ? null : JSON.parse(row.error_json);
    const expired = row.status === 'running' && row.lease_until! <= this.now().toISOString();
    return {
      jobId: row.job_id, kind: row.kind, status: row.status, stage: row.stage,
      eventCursor: row.event_cursor, attempts: row.attempts, result, error,
      resumable: expired || ((row.status === 'failed' || row.status === 'waiting_user') &&
        result === null && error?.retryable === true),
    };
  }

  private append(scopeId: string, jobId: string, stage: string, message: string): void {
    const at = this.now().toISOString();
    this.db.prepare('UPDATE vl_jobs SET event_cursor=event_cursor+1, stage=?, updated_at=? WHERE scope_id=? AND job_id=?')
      .run(stage, at, scopeId, jobId);
    this.db.prepare(`INSERT INTO vl_job_events(scope_id, job_id, cursor, stage, message, created_at)
      SELECT scope_id, job_id, event_cursor, ?, ?, ? FROM vl_jobs WHERE scope_id=? AND job_id=?`)
      .run(stage, message, at, scopeId, jobId);
  }

  private requireLease(scopeId: string, jobId: string, lease: string): JobRow {
    const row = this.row(scopeId, jobId);
    parse(id, lease);
    if (row.status !== 'running' || row.lease_token !== lease || row.lease_until! <= this.now().toISOString()) conflict();
    return row;
  }

  create(scopeId: string, kind: JobKind, key: string, input: unknown): JobView {
    parse(id, scopeId);
    parse(kindSchema, kind);
    parse(id, key);
    const request = canonicalJson(input);
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM vl_jobs WHERE scope_id=? AND kind=? AND idempotency_key=?')
        .get(scopeId, kind, key) as JobRow | undefined;
      if (prior) {
        if (prior.input_json !== request) conflict();
        return this.view(prior);
      }
      const jobId = randomUUID();
      const at = this.now().toISOString();
      this.db.prepare(`INSERT INTO vl_jobs
        (scope_id,job_id,kind,idempotency_key,input_json,status,stage,created_at,updated_at)
        VALUES (?,?,?,?,?,'queued','queued',?,?)`).run(scopeId, jobId, kind, key, request, at, at);
      this.append(scopeId, jobId, 'queued', '任务已排队');
      return this.get(scopeId, jobId);
    }).immediate();
  }

  get(scopeId: string, jobId: string): JobView {
    return this.view(this.row(scopeId, jobId));
  }

  // 只供受信任 runner 读取，不将请求正文和检查点放入公开任务 DTO。
  getWork(scopeId: string, jobId: string): { input: unknown; checkpoint: unknown } {
    const row = this.row(scopeId, jobId);
    return { input: JSON.parse(row.input_json), checkpoint: row.checkpoint_json === null ? null : JSON.parse(row.checkpoint_json) };
  }

  list(scopeId: string): JobView[] {
    parse(id, scopeId);
    const rows = this.db.prepare('SELECT * FROM vl_jobs WHERE scope_id=? ORDER BY created_at DESC, job_id DESC LIMIT 50')
      .all(scopeId) as JobRow[];
    return rows.map(row => this.view(row));
  }

  events(scopeId: string, jobId: string, afterCursor: number): JobEvent[] {
    this.row(scopeId, jobId);
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) invalid();
    return this.db.prepare(`SELECT cursor, stage, message, created_at AS createdAt FROM vl_job_events
      WHERE scope_id=? AND job_id=? AND cursor>? ORDER BY cursor LIMIT 100`)
      .all(scopeId, jobId, afterCursor) as JobEvent[];
  }

  claim(scopeId: string, jobId: string): string | null {
    return this.db.transaction(() => {
      const row = this.row(scopeId, jobId);
      if (row.status !== 'queued') return null;
      if (!Number.isSafeInteger(row.attempts + 1)) invalid();
      const lease = randomUUID();
      const until = new Date(this.now().getTime() + LEASE_MS).toISOString();
      this.db.prepare(`UPDATE vl_jobs SET status='running', attempts=attempts+1, lease_token=?, lease_until=?
        WHERE scope_id=? AND job_id=? AND status='queued'`).run(lease, until, scopeId, jobId);
      this.append(scopeId, jobId, row.stage === 'queued' ? 'running' : row.stage, '任务开始执行');
      return lease;
    }).immediate();
  }

  /** 仅活跃 worker 续租；进程退出后停止，仍可通过过期租约人工恢复。 */
  keepAlive(scopeId: string, jobId: string, lease: string): () => void {
    const timer = setInterval(() => {
      try {
        const now = this.now();
        const result = this.db.prepare(`UPDATE vl_jobs SET lease_until=?
          WHERE scope_id=? AND job_id=? AND status='running' AND lease_token=? AND lease_until>?`)
          .run(new Date(now.getTime() + LEASE_MS).toISOString(), scopeId, jobId, lease, now.toISOString());
        if (!result.changes) clearInterval(timer);
      } catch {
        clearInterval(timer);
        console.error('任务续租失败；停止心跳，任务将按租约过期处理');
      }
    }, LEASE_MS / 3);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  checkpoint(scopeId: string, jobId: string, lease: string, stage: string, data: unknown): JobView {
    return this.db.transaction(() => {
      this.requireLease(scopeId, jobId, lease);
      parse(id, stage);
      const serialized = canonicalJson(data);
      const until = new Date(this.now().getTime() + LEASE_MS).toISOString();
      this.db.prepare('UPDATE vl_jobs SET checkpoint_json=?, lease_until=? WHERE scope_id=? AND job_id=?')
        .run(serialized, until, scopeId, jobId);
      this.append(scopeId, jobId, stage, '阶段结果已保存');
      return this.get(scopeId, jobId);
    }).immediate();
  }

  finish(scopeId: string, jobId: string, lease: string, status: 'waiting_user' | 'succeeded' | 'failed',
    result: JobResult | null, error: JobError | null): JobView {
    return this.db.transaction(() => {
      this.requireLease(scopeId, jobId, lease);
      parse(z.enum(['waiting_user', 'succeeded', 'failed']), status);
      const parsedResult = result === null ? null : parse(resultSchema, result);
      const parsedError = error === null ? null : parse(errorSchema, error);
      if ((status === 'succeeded' && (!parsedResult || parsedError)) ||
        (status === 'failed' && (parsedResult || !parsedError)) ||
        (status === 'waiting_user' && ((!parsedResult && !parsedError) || (parsedResult && parsedError)))) invalid();
      this.db.prepare(`UPDATE vl_jobs SET status=?, result_json=?, error_json=?, lease_token=NULL, lease_until=NULL
        WHERE scope_id=? AND job_id=?`)
        .run(status, parsedResult === null ? null : JSON.stringify(parsedResult),
          parsedError === null ? null : JSON.stringify(parsedError), scopeId, jobId);
      this.append(scopeId, jobId, status, status === 'succeeded' ? '任务已完成' : status === 'failed' ? '任务执行失败' : '任务等待确认');
      return this.get(scopeId, jobId);
    }).immediate();
  }

  resume(scopeId: string, jobId: string): JobView {
    return this.db.transaction(() => {
      const row = this.row(scopeId, jobId);
      if (row.status === 'queued') return this.view(row);
      if (!this.view(row).resumable) conflict();
      this.db.prepare(`UPDATE vl_jobs SET status='queued', error_json=NULL, lease_token=NULL, lease_until=NULL
        WHERE scope_id=? AND job_id=?`).run(scopeId, jobId);
      this.append(scopeId, jobId, row.checkpoint_json === null ? 'queued' : row.stage, '用户请求恢复任务');
      return this.get(scopeId, jobId);
    }).immediate();
  }

  cancel(scopeId: string, jobId: string): JobView {
    return this.db.transaction(() => {
      const row = this.row(scopeId, jobId);
      if (row.status === 'succeeded') conflict();
      if (row.status === 'cancelled') return this.view(row);
      this.db.prepare(`UPDATE vl_jobs SET status='cancelled', lease_token=NULL, lease_until=NULL
        WHERE scope_id=? AND job_id=?`).run(scopeId, jobId);
      this.append(scopeId, jobId, 'cancelled', '用户取消任务');
      return this.get(scopeId, jobId);
    }).immediate();
  }
}
