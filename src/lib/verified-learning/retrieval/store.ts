import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SourceSnapshot } from '../sources';
import { LearningError } from '../contracts';
import { AppError } from '../errors';
import { redact } from '../provider-error';
import { MAX_BATCH_REQUESTS, batches, ensureChunks, pendingChunks, saveVector, sourceChunks } from './indexer';
import type { EmbeddingPort } from './indexer';
import type { EmbeddingProfile } from './profile';
import { encodeVector } from './vector';

const LEASE_MS = 90_000;
const DONE = new Set(['succeeded', 'failed', 'cancelled']);

type JobStatus = 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';

interface IndexJobRow {
  scope_id: string; job_id: string; book_id: string; source_revision: string; profile_id: string;
  idempotency_key: string; status: JobStatus; lease_token: string | null; lease_until: string | null;
  progress_json: string; error_code: string | null; created_at: string; updated_at: string;
}

export interface IndexProgress {
  total: number;
  ready: number;
  failed: number;
  requests: number;
}

export interface IndexJobView {
  jobId: string;
  status: JobStatus;
  bookId: string;
  sourceRevision: string;
  profileId: string;
  progress: IndexProgress;
  error: { code: string; message: string; retryable: boolean } | null;
  resumable: boolean;
}

export interface IndexStatusView {
  status: 'none' | JobStatus;
  profileId: string;
  ready: number;
  failed: number;
  total: number;
  jobId: string | null;
  /** ready 向量是否覆盖全部派生块；false 时检索只用关键词或已有向量 */
  usable: boolean;
}

function errorText(code: string): string {
  if (code === 'EMBEDDING_UNAUTHORIZED') return 'Embedding 服务拒绝了当前 Key，请检查配置后恢复任务';
  if (code === 'EMBEDDING_LIMIT') return 'Embedding 服务限流或额度不足，稍后恢复任务';
  if (code === 'EMBEDDING_BATCHES_EXHAUSTED') return '本次授权的索引批次已用完，确认后可继续';
  return 'Embedding 服务暂时不可用，已改用关键词检索';
}

/**
 * 语义索引任务：独立于 vl_jobs，避免重建其 CHECK 约束。
 * 凭据不写入任务记录；已 ready 且配置匹配的向量不会再次请求，恢复任务不重复计费。
 */
export class IndexJobStore {
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {}

  private row(scopeId: string, jobId: string): IndexJobRow {
    const row = this.db.prepare('SELECT * FROM vl_index_jobs WHERE scope_id=? AND job_id=?').get(scopeId, jobId) as IndexJobRow | undefined;
    if (!row) throw new LearningError('NOT_FOUND', '索引任务不存在');
    return row;
  }

  private view(row: IndexJobRow): IndexJobView {
    const progress = JSON.parse(row.progress_json) as IndexProgress;
    const expired = row.status === 'running' && (row.lease_until ?? '') <= this.now().toISOString();
    return {
      jobId: row.job_id, status: row.status, bookId: row.book_id, sourceRevision: row.source_revision, profileId: row.profile_id,
      progress,
      error: row.error_code ? { code: row.error_code, message: errorText(row.error_code), retryable: true } : null,
      resumable: expired || row.status === 'failed' || row.status === 'waiting_user',
    };
  }

  get(scopeId: string, jobId: string): IndexJobView { return this.view(this.row(scopeId, jobId)); }

  /** 创建任务；同一幂等键返回同一任务，同一来源修订/profile 已有未结束任务时拒绝，避免重复付费 */
  create(input: { scopeId: string; key: string; source: SourceSnapshot; profile: EmbeddingProfile }): IndexJobView {
    if (!input.key.trim() || input.key.length > 200) throw new LearningError('INVALID_INPUT', '需要合法的 Idempotency-Key');
    const prior = this.db.prepare('SELECT * FROM vl_index_jobs WHERE scope_id=? AND idempotency_key=?').get(input.scopeId, input.key) as IndexJobRow | undefined;
    if (prior) {
      if (prior.book_id !== input.source.sourceId || prior.source_revision !== input.source.sourceRevision || prior.profile_id !== input.profile.profileId) {
        throw new LearningError('VERSION_CONFLICT', '同一幂等键已用于其他索引任务');
      }
      return this.view(prior);
    }
    const at = this.now().toISOString();
    const jobId = randomUUID();
    this.db.transaction(() => {
      const active = this.db.prepare(`SELECT 1 FROM vl_index_jobs WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=? AND status IN ('queued','running','waiting_user')`)
        .get(input.scopeId, input.source.sourceId, input.source.sourceRevision, input.profile.profileId);
      if (active) throw new AppError('IN_PROGRESS', '该教材的语义索引已在进行');
      this.db.prepare(`INSERT INTO vl_index_jobs(scope_id,job_id,book_id,source_revision,profile_id,idempotency_key,status,progress_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'queued','{}',?,?)`).run(input.scopeId, jobId, input.source.sourceId, input.source.sourceRevision, input.profile.profileId, input.key, at, at);
    }).immediate();
    return this.get(input.scopeId, jobId);
  }

  claim(scopeId: string, jobId: string): string | null {
    return this.db.transaction(() => {
      const row = this.row(scopeId, jobId);
      if (row.status !== 'queued') return null;
      const lease = randomUUID();
      const at = this.now().toISOString();
      this.db.prepare('UPDATE vl_index_jobs SET status=?, lease_token=?, lease_until=?, updated_at=? WHERE scope_id=? AND job_id=? AND status=?')
        .run('running', lease, new Date(this.now().getTime() + LEASE_MS).toISOString(), at, scopeId, jobId, 'queued');
      return lease;
    }).immediate();
  }

  keepAlive(scopeId: string, jobId: string, lease: string): () => void {
    const timer = setInterval(() => {
      const now = this.now();
      const changed = this.db.prepare('UPDATE vl_index_jobs SET lease_until=? WHERE scope_id=? AND job_id=? AND status=? AND lease_token=? AND lease_until>?')
        .run(new Date(now.getTime() + LEASE_MS).toISOString(), scopeId, jobId, 'running', lease, now.toISOString()).changes;
      if (!changed) clearInterval(timer);
    }, LEASE_MS / 3);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private touch(scopeId: string, jobId: string, lease: string, progress: IndexProgress): void {
    const at = this.now().toISOString();
    const changed = this.db.prepare('UPDATE vl_index_jobs SET progress_json=?, lease_until=?, updated_at=? WHERE scope_id=? AND job_id=? AND status=? AND lease_token=?')
      .run(JSON.stringify(progress), new Date(this.now().getTime() + LEASE_MS).toISOString(), at, scopeId, jobId, 'running', lease).changes;
    if (!changed) throw new AppError('VERSION_CONFLICT', '索引任务执行权已变化');
  }

  private finish(scopeId: string, jobId: string, lease: string, status: JobStatus, progress: IndexProgress, errorCode: string | null): void {
    const changed = this.db.prepare(`UPDATE vl_index_jobs SET status=?, progress_json=?, error_code=?, lease_token=NULL, lease_until=NULL, updated_at=?
      WHERE scope_id=? AND job_id=? AND status='running' AND lease_token=?`)
      .run(status, JSON.stringify(progress), errorCode, this.now().toISOString(), scopeId, jobId, lease).changes;
    if (!changed) throw new AppError('VERSION_CONFLICT', '索引任务状态已变化');
  }

  /** 用户取消；运行中的任务在下一批次前发现状态变化后停止写入 */
  cancel(scopeId: string, jobId: string): IndexJobView {
    const row = this.row(scopeId, jobId);
    if (DONE.has(row.status)) return this.view(row);
    this.db.prepare('UPDATE vl_index_jobs SET status=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE scope_id=? AND job_id=?')
      .run('cancelled', this.now().toISOString(), scopeId, jobId);
    return this.get(scopeId, jobId);
  }

  /** 显式恢复：只允许失败、取消或租约过期的任务重新排队 */
  resume(scopeId: string, jobId: string): IndexJobView {
    const view = this.get(scopeId, jobId);
    if (!view.resumable) throw new AppError('FORBIDDEN', '该索引任务不能恢复');
    this.db.prepare("UPDATE vl_index_jobs SET status='queued', lease_token=NULL, lease_until=NULL, error_code=NULL, updated_at=? WHERE scope_id=? AND job_id=?")
      .run(this.now().toISOString(), scopeId, jobId);
    return this.get(scopeId, jobId);
  }

  status(scopeId: string, bookId: string, sourceRevision: string, profileId: string): IndexStatusView {
    const totals = this.db.prepare(`SELECT count(*) AS total,
        sum(CASE WHEN v.status='ready' THEN 1 ELSE 0 END) AS ready,
        sum(CASE WHEN v.status='failed' THEN 1 ELSE 0 END) AS failed
      FROM vl_retrieval_chunks c
      LEFT JOIN vl_retrieval_vectors v ON v.scope_id=c.scope_id AND v.book_id=c.book_id AND v.source_revision=c.source_revision
        AND v.chapter_id=c.chapter_id AND v.paragraph_index=c.paragraph_index AND v.part_index=c.part_index AND v.profile_id=?
      WHERE c.scope_id=? AND c.book_id=? AND c.source_revision=?`).get(profileId, scopeId, bookId, sourceRevision) as { total: number; ready: number | null; failed: number | null };
    const job = this.db.prepare(`SELECT * FROM vl_index_jobs WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=?
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'waiting_user' THEN 2 ELSE 3 END, created_at DESC LIMIT 1`)
      .get(scopeId, bookId, sourceRevision, profileId) as IndexJobRow | undefined;
    const total = totals.total ?? 0;
    const ready = totals.ready ?? 0;
    return { status: job ? job.status : 'none', profileId, ready, failed: totals.failed ?? 0, total, jobId: job?.job_id ?? null, usable: total > 0 && ready === total };
  }

  /**
   * 执行一次索引任务：逐批请求向量、短事务落库、批次之间核对执行权。
   * 单批最多重试 2 次；达到批次授权上限时进入 waiting_user，已完成部分保留。
   */
  async run(target: { scopeId: string; jobId: string; source: SourceSnapshot; profile: EmbeddingProfile }, port: EmbeddingPort, options: { signal?: AbortSignal; maxRequests?: number } = {}): Promise<IndexJobView> {
    const lease = this.claim(target.scopeId, target.jobId);
    if (!lease) return this.get(target.scopeId, target.jobId);
    const heartbeat = this.keepAlive(target.scopeId, target.jobId, lease);
    const maxRequests = options.maxRequests ?? MAX_BATCH_REQUESTS;
    const chunks = sourceChunks(target.scopeId, target.source, target.profile.preprocessVersion);
    const progress: IndexProgress = { ...this.get(target.scopeId, target.jobId).progress, total: chunks.length };
    try {
      ensureChunks(this.db, target.scopeId, chunks);
      const pending = pendingChunks(this.db, target.scopeId, target.source.sourceId, target.source.sourceRevision, chunks, target.profile);
      let requests = progress.requests;
      for (const batch of batches(pending)) {
        options.signal?.throwIfAborted();
        if (requests >= maxRequests) {
          this.finish(target.scopeId, target.jobId, lease, 'waiting_user', { ...progress, requests }, 'EMBEDDING_BATCHES_EXHAUSTED');
          return this.get(target.scopeId, target.jobId);
        }
        if (this.row(target.scopeId, target.jobId).status !== 'running') return this.get(target.scopeId, target.jobId);
        let failure: unknown;
        for (let attempt = 0; attempt <= 2; attempt++) {
          failure = undefined;
          try {
            requests++;
            const vectors = await port.embed(batch.map(chunk => chunk.text));
            if (vectors.length !== batch.length) throw new Error('返回数量不匹配');
            this.db.transaction(() => {
              batch.forEach((chunk, index) => {
                const values = vectors[index];
                const dimensions = target.profile.dimensions ?? values?.length ?? 0;
                if (!values || !dimensions || values.length !== dimensions) {
                  saveVector(this.db, target.scopeId, target.profile, chunk, dimensions, 'failed', null, 'DIMENSION_MISMATCH'); progress.failed++; return;
                }
                try {
                  saveVector(this.db, target.scopeId, target.profile, chunk, dimensions, 'ready', encodeVector(values), null); progress.ready++;
                } catch {
                  saveVector(this.db, target.scopeId, target.profile, chunk, dimensions, 'failed', null, 'DIMENSION_MISMATCH'); progress.failed++;
                }
              });
            })();
            break;
          } catch (error) { failure = error; }
        }
        if (failure) {
          const message = redact(failure instanceof Error ? failure.message : String(failure));
          const code = /401|403|unauthor|invalid key|api key/i.test(message) ? 'EMBEDDING_UNAUTHORIZED' : /429|quota|rate|limit/i.test(message) ? 'EMBEDDING_LIMIT' : 'EMBEDDING_FAILED';
          this.db.transaction(() => {
            for (const chunk of batch) saveVector(this.db, target.scopeId, target.profile, chunk, target.profile.dimensions ?? 0, 'failed', null, code);
          })();
          progress.failed += batch.length;
          this.finish(target.scopeId, target.jobId, lease, 'failed', { ...progress, requests }, code);
          return this.get(target.scopeId, target.jobId);
        }
        this.touch(target.scopeId, target.jobId, lease, { ...progress, requests });
      }
      this.finish(target.scopeId, target.jobId, lease, 'succeeded', { ...progress, requests }, null);
      return this.get(target.scopeId, target.jobId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'VERSION_CONFLICT') return this.get(target.scopeId, target.jobId);
      try { this.finish(target.scopeId, target.jobId, lease, 'failed', progress, 'EMBEDDING_FAILED'); } catch { /* 执行权已转移，不覆盖新状态 */ }
      return this.get(target.scopeId, target.jobId);
    } finally { heartbeat(); }
  }
}
