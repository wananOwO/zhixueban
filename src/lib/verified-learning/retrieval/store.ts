import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SourceSnapshot } from '../sources';
import { LearningError } from '../contracts';
import { AppError } from '../errors';
import { redact } from '../provider-error';
import {
  MAX_BATCH_REQUESTS,
  batches,
  ensureChunks,
  invalidateProfileVectors,
  pendingChunks,
  saveVector,
  sourceChunks,
  type EmbeddingPort,
} from './indexer';
import type { EmbeddingProfile } from './profile';
import { encodeVector } from './vector';

const LEASE_MS = 90_000;
const DONE = new Set(['succeeded', 'failed', 'cancelled']);
const MAX_PROCESS_INDEX_JOBS = 2;
let activeProcessIndexJobs = 0;

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
  leaseExpired?: boolean;
}

export interface IndexStatusView {
  status: 'none' | JobStatus;
  profileId: string;
  ready: number;
  failed: number;
  total: number;
  jobId: string | null;
  /** ready 向量是否覆盖全部派生块；false 时检索使用已有向量 + 关键词检索 */
  usable: boolean;
  resumable: boolean;
  leaseExpired: boolean;
  error: { code: string; message: string; retryable: boolean } | null;
}

function normalizeProgress(json: string): IndexProgress {
  try {
    const raw = JSON.parse(json) as Partial<IndexProgress>;
    return {
      total: Number.isSafeInteger(raw.total) && raw.total! >= 0 ? raw.total! : 0,
      ready: Number.isSafeInteger(raw.ready) && raw.ready! >= 0 ? raw.ready! : 0,
      failed: Number.isSafeInteger(raw.failed) && raw.failed! >= 0 ? raw.failed! : 0,
      requests: Number.isSafeInteger(raw.requests) && raw.requests! >= 0 ? raw.requests! : 0,
    };
  } catch {
    return { total: 0, ready: 0, failed: 0, requests: 0 };
  }
}

function errorText(code: string): string {
  if (code === 'MODEL_KEY_REQUIRED') return '服务重启后未保留内存 Key，请确认设置后点击继续（已完成段落不重复计费）';
  if (code === 'EMBEDDING_UNAUTHORIZED') return 'Embedding 服务拒绝了当前 Key，请检查配置后恢复任务';
  if (code === 'EMBEDDING_LIMIT') return 'Embedding 服务限流或额度不足，稍后可恢复任务';
  if (code === 'EMBEDDING_BATCHES_EXHAUSTED') return '本次授权的 100 批索引请求已用完，确认后可继续剩余段落';
  if (code === 'EMBEDDING_CONCURRENCY_LIMIT') return '当前服务同时运行的索引任务已达上限，请稍后点击继续';
  if (code === 'DIMENSION_MISMATCH') return '部分段落返回的向量维度或数值异常，可以点击重试未完成段落';
  if (code === 'LEASE_EXPIRED') return '上次索引因服务重启中断，确认配置后可继续剩余段落';
  return 'Embedding 服务暂时不可用，当前自动使用关键词检索';
}

function classifyFailure(error: unknown): { code: string; transient: boolean } {
  if ((error as { code?: unknown })?.code === 'MODEL_KEY_REQUIRED') {
    return { code: 'MODEL_KEY_REQUIRED', transient: false };
  }
  if ((error as { code?: unknown })?.code === 'INVALID_INPUT') {
    return { code: 'EMBEDDING_FAILED', transient: false };
  }
  const message = redact(error instanceof Error ? error.message : String(error));
  if (/401|403|unauthor|invalid key|api key|forbidden/i.test(message)) {
    return { code: 'EMBEDDING_UNAUTHORIZED', transient: false };
  }
  if (/429|quota|rate|limit/i.test(message)) {
    return { code: 'EMBEDDING_LIMIT', transient: true };
  }
  if (/400|404|422|格式不合法|数量与请求不一致|向量不合法/.test(message)) {
    return { code: 'EMBEDDING_FAILED', transient: false };
  }
  return { code: 'EMBEDDING_FAILED', transient: true };
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

  private isExpired(row: IndexJobRow): boolean {
    return row.status === 'running' && (row.lease_until ?? '') <= this.now().toISOString();
  }

  private view(row: IndexJobRow): IndexJobView {
    const progress = normalizeProgress(row.progress_json);
    const expired = this.isExpired(row);
    const effectiveCode = row.error_code ?? (expired ? 'LEASE_EXPIRED' : null);
    return {
      jobId: row.job_id,
      status: row.status,
      bookId: row.book_id,
      sourceRevision: row.source_revision,
      profileId: row.profile_id,
      progress,
      error: effectiveCode ? { code: effectiveCode, message: errorText(effectiveCode), retryable: true } : null,
      resumable: expired || row.status === 'failed' || row.status === 'waiting_user',
      leaseExpired: expired,
    };
  }

  get(scopeId: string, jobId: string): IndexJobView { return this.view(this.row(scopeId, jobId)); }

  private countVectors(scopeId: string, bookId: string, sourceRevision: string, profileId: string): { total: number; ready: number; failed: number } {
    const row = this.db.prepare(`SELECT count(*) AS total,
        sum(CASE WHEN v.status='ready' THEN 1 ELSE 0 END) AS ready,
        sum(CASE WHEN v.status='failed' THEN 1 ELSE 0 END) AS failed
      FROM vl_retrieval_chunks c
      LEFT JOIN vl_retrieval_vectors v ON v.scope_id=c.scope_id AND v.book_id=c.book_id AND v.source_revision=c.source_revision
        AND v.chapter_id=c.chapter_id AND v.paragraph_index=c.paragraph_index AND v.part_index=c.part_index AND v.profile_id=?
      WHERE c.scope_id=? AND c.book_id=? AND c.source_revision=?`).get(profileId, scopeId, bookId, sourceRevision) as {
      total: number; ready: number | null; failed: number | null;
    };
    return { total: row.total ?? 0, ready: row.ready ?? 0, failed: row.failed ?? 0 };
  }

  /**
   * 创建任务：同一幂等键返回同一任务；同一来源修订/profile（或线上模式同一空间）已有活跃任务时拒绝。
   * rebuild=true 时将既有同 profile 向量标为 stale 以便完整重建。
   */
  create(input: {
    scopeId: string;
    key: string;
    source: SourceSnapshot;
    profile: EmbeddingProfile;
    rebuild?: boolean;
    singlePerScope?: boolean;
  }): IndexJobView {
    if (!input.key.trim() || input.key.length > 200) throw new LearningError('INVALID_INPUT', '需要合法的 Idempotency-Key');
    const prior = this.db.prepare('SELECT * FROM vl_index_jobs WHERE scope_id=? AND idempotency_key=?').get(input.scopeId, input.key) as IndexJobRow | undefined;
    if (prior) {
      if (prior.book_id !== input.source.sourceId || prior.source_revision !== input.source.sourceRevision || prior.profile_id !== input.profile.profileId) {
        throw new LearningError('VERSION_CONFLICT', '同一幂等键已用于其他索引任务');
      }
      return this.view(prior);
    }
    const chunks = sourceChunks(input.scopeId, input.source, input.profile.preprocessVersion);
    const at = this.now().toISOString();
    const jobId = randomUUID();

    this.db.transaction(() => {
      if (input.singlePerScope) {
        const scopeActive = this.db.prepare(
          `SELECT job_id, status, lease_until FROM vl_index_jobs WHERE scope_id=? AND status IN ('queued','running')`,
        ).all(input.scopeId) as { job_id: string; status: string; lease_until: string | null }[];
        if (scopeActive.some(item => item.status === 'queued' || (item.lease_until ?? '') > at)) {
          throw new AppError('IN_PROGRESS', '当前空间已有正在进行的语义索引任务，请等待完成或先停止');
        }
      }
      const active = this.db.prepare(
        `SELECT 1 FROM vl_index_jobs WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=? AND status IN ('queued','running','waiting_user')`,
      ).get(input.scopeId, input.source.sourceId, input.source.sourceRevision, input.profile.profileId);
      if (active) throw new AppError('IN_PROGRESS', '该教材的语义索引已在进行');

      ensureChunks(this.db, input.scopeId, chunks);
      if (input.rebuild) {
        invalidateProfileVectors(this.db, input.scopeId, input.source.sourceId, input.source.sourceRevision, input.profile.profileId);
      }
      const counts = this.countVectors(input.scopeId, input.source.sourceId, input.source.sourceRevision, input.profile.profileId);
      const initialProgress: IndexProgress = { total: chunks.length, ready: counts.ready, failed: counts.failed, requests: 0 };

      this.db.prepare(`INSERT INTO vl_index_jobs(scope_id,job_id,book_id,source_revision,profile_id,idempotency_key,status,progress_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'queued',?,?,?)`).run(
        input.scopeId, jobId, input.source.sourceId, input.source.sourceRevision,
        input.profile.profileId, input.key, JSON.stringify(initialProgress), at, at,
      );
    }).immediate();
    return this.get(input.scopeId, jobId);
  }

  claim(scopeId: string, jobId: string): string | null {
    return this.db.transaction(() => {
      const row = this.row(scopeId, jobId);
      if (row.status !== 'queued') return null;
      const lease = randomUUID();
      const now = this.now();
      this.db.prepare('UPDATE vl_index_jobs SET status=?, lease_token=?, lease_until=?, updated_at=? WHERE scope_id=? AND job_id=? AND status=?')
        .run('running', lease, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString(), scopeId, jobId, 'queued');
      return lease;
    }).immediate();
  }

  private hasLease(scopeId: string, jobId: string, lease: string): boolean {
    const row = this.db.prepare('SELECT status, lease_token, lease_until FROM vl_index_jobs WHERE scope_id=? AND job_id=?').get(scopeId, jobId) as
      { status: string; lease_token: string | null; lease_until: string | null } | undefined;
    if (!row || row.status !== 'running' || row.lease_token !== lease) return false;
    return (row.lease_until ?? '') > this.now().toISOString();
  }

  private assertLease(scopeId: string, jobId: string, lease: string): void {
    if (!this.hasLease(scopeId, jobId, lease)) {
      throw new AppError('VERSION_CONFLICT', '索引任务执行权已变化');
    }
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
    const now = this.now();
    const changed = this.db.prepare(
      'UPDATE vl_index_jobs SET progress_json=?, lease_until=?, updated_at=? WHERE scope_id=? AND job_id=? AND status=? AND lease_token=? AND lease_until>?',
    ).run(JSON.stringify(progress), new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString(), scopeId, jobId, 'running', lease, now.toISOString()).changes;
    if (!changed) throw new AppError('VERSION_CONFLICT', '索引任务执行权已变化');
  }

  private finish(scopeId: string, jobId: string, lease: string, status: JobStatus, progress: IndexProgress, errorCode: string | null): void {
    const now = this.now();
    const changed = this.db.prepare(`UPDATE vl_index_jobs SET status=?, progress_json=?, error_code=?, lease_token=NULL, lease_until=NULL, updated_at=?
      WHERE scope_id=? AND job_id=? AND status='running' AND lease_token=? AND lease_until>?`)
      .run(status, JSON.stringify(progress), errorCode, now.toISOString(), scopeId, jobId, lease, now.toISOString()).changes;
    if (!changed) throw new AppError('VERSION_CONFLICT', '索引任务状态已变化');
  }

  /** 用户取消；运行中的任务在网络返回后检测到租约失效即停止写入 */
  cancel(scopeId: string, jobId: string): IndexJobView {
    const row = this.row(scopeId, jobId);
    if (DONE.has(row.status)) return this.view(row);
    this.db.prepare('UPDATE vl_index_jobs SET status=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE scope_id=? AND job_id=?')
      .run('cancelled', this.now().toISOString(), scopeId, jobId);
    return this.get(scopeId, jobId);
  }

  /** 显式恢复：只允许失败、waiting_user 或租约过期的任务重新排队；每次续跑重置本次批次计数 */
  resume(scopeId: string, jobId: string): IndexJobView {
    const row = this.row(scopeId, jobId);
    const view = this.view(row);
    if (!view.resumable) throw new AppError('FORBIDDEN', '该索引任务不能恢复');
    const resetProgress: IndexProgress = { ...view.progress, requests: 0 };
    this.db.prepare(
      "UPDATE vl_index_jobs SET status='queued', progress_json=?, lease_token=NULL, lease_until=NULL, error_code=NULL, updated_at=? WHERE scope_id=? AND job_id=?",
    ).run(JSON.stringify(resetProgress), this.now().toISOString(), scopeId, jobId);
    return this.get(scopeId, jobId);
  }

  status(scopeId: string, bookId: string, sourceRevision: string, profileId: string, expectedTotal?: number): IndexStatusView {
    const counts = this.countVectors(scopeId, bookId, sourceRevision, profileId);
    const job = this.db.prepare(`SELECT * FROM vl_index_jobs WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=?
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'waiting_user' THEN 2 ELSE 3 END, created_at DESC LIMIT 1`)
      .get(scopeId, bookId, sourceRevision, profileId) as IndexJobRow | undefined;
    const total = counts.total > 0 ? counts.total : (expectedTotal ?? 0);
    const ready = counts.ready;
    const jobView = job ? this.view(job) : null;
    return {
      status: job ? job.status : 'none',
      profileId,
      ready,
      failed: counts.failed,
      total,
      jobId: job?.job_id ?? null,
      usable: counts.total > 0 && ready === counts.total,
      resumable: jobView?.resumable ?? false,
      leaseExpired: jobView?.leaseExpired ?? false,
      error: jobView?.error ?? null,
    };
  }

  /**
   * 执行一次索引任务：
   * - 单进程最多 2 个并发索引任务，超出时进入 waiting_user 等待用户稍后继续；
   * - 单批暂时性故障最多退避重试 2 次（重试也计入 100 批次请求上限），鉴权错误不重试；
   * - 网络返回后写库前必须复查租约，失去租约绝不写结果。
   */
  async run(
    target: { scopeId: string; jobId: string; source: SourceSnapshot; profile: EmbeddingProfile },
    port: EmbeddingPort,
    options: { signal?: AbortSignal; maxRequests?: number; retryDelayMs?: number } = {},
  ): Promise<IndexJobView> {
    const lease = this.claim(target.scopeId, target.jobId);
    if (!lease) return this.get(target.scopeId, target.jobId);

    if (activeProcessIndexJobs >= MAX_PROCESS_INDEX_JOBS) {
      const current = this.get(target.scopeId, target.jobId).progress;
      this.finish(target.scopeId, target.jobId, lease, 'waiting_user', current, 'EMBEDDING_CONCURRENCY_LIMIT');
      return this.get(target.scopeId, target.jobId);
    }

    activeProcessIndexJobs++;
    const heartbeat = this.keepAlive(target.scopeId, target.jobId, lease);
    const maxRequests = options.maxRequests ?? MAX_BATCH_REQUESTS;
    const baseDelayMs = options.retryDelayMs ?? 300;
    const chunks = sourceChunks(target.scopeId, target.source, target.profile.preprocessVersion);
    let requests = this.get(target.scopeId, target.jobId).progress.requests;

    const currentProgress = (): IndexProgress => {
      const counts = this.countVectors(target.scopeId, target.source.sourceId, target.source.sourceRevision, target.profile.profileId);
      return { total: chunks.length, ready: counts.ready, failed: counts.failed, requests };
    };

    try {
      ensureChunks(this.db, target.scopeId, chunks);
      const pending = pendingChunks(this.db, target.scopeId, target.source.sourceId, target.source.sourceRevision, chunks, target.profile);
      let expectedDims: number | null = target.profile.dimensions;

      for (const batch of batches(pending)) {
        options.signal?.throwIfAborted();
        this.assertLease(target.scopeId, target.jobId, lease);

        let vectors: number[][] | null = null;
        let lastFailure: unknown;

        for (let attempt = 0; attempt <= 2; attempt++) {
          if (requests >= maxRequests) {
            this.finish(target.scopeId, target.jobId, lease, 'waiting_user', currentProgress(), 'EMBEDDING_BATCHES_EXHAUSTED');
            return this.get(target.scopeId, target.jobId);
          }
          if (attempt > 0 && baseDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
          }
          options.signal?.throwIfAborted();
          this.assertLease(target.scopeId, target.jobId, lease);

          requests++;
          try {
            const response = await port.embed(batch.map(chunk => chunk.text), { signal: options.signal });
            if (response.length !== batch.length) throw new Error('Embedding 服务返回数量与请求不一致');
            vectors = response;
            lastFailure = undefined;
            break;
          } catch (error) {
            lastFailure = error;
            if (options.signal?.aborted) throw error;
            const { transient } = classifyFailure(error);
            if (!transient) break;
          }
        }

        // 网络等待结束后必须再次核验租约，若已被取消或租约转移则绝不写入任何向量
        this.assertLease(target.scopeId, target.jobId, lease);

        if (!vectors || lastFailure !== undefined) {
          const { code } = classifyFailure(lastFailure);
          this.db.transaction(() => {
            this.assertLease(target.scopeId, target.jobId, lease);
            for (const chunk of batch) {
              saveVector(this.db, target.scopeId, target.profile, chunk, target.profile.dimensions ?? 0, 'failed', null, code);
            }
          })();
          this.finish(target.scopeId, target.jobId, lease, 'failed', currentProgress(), code);
          return this.get(target.scopeId, target.jobId);
        }

        this.db.transaction(() => {
          this.assertLease(target.scopeId, target.jobId, lease);
          batch.forEach((chunk, index) => {
            const values = vectors[index];
            const dimensions = expectedDims ?? values?.length ?? 0;
            if (!values || !dimensions || values.length !== dimensions) {
              saveVector(this.db, target.scopeId, target.profile, chunk, Math.max(0, values?.length ?? 0), 'failed', null, 'DIMENSION_MISMATCH');
              return;
            }
            try {
              saveVector(this.db, target.scopeId, target.profile, chunk, dimensions, 'ready', encodeVector(values), null);
              if (expectedDims === null) expectedDims = dimensions;
            } catch {
              saveVector(this.db, target.scopeId, target.profile, chunk, dimensions, 'failed', null, 'DIMENSION_MISMATCH');
            }
          });
        })();
        this.touch(target.scopeId, target.jobId, lease, currentProgress());
      }

      const finalProgress = currentProgress();
      if (finalProgress.failed > 0) {
        this.finish(target.scopeId, target.jobId, lease, 'failed', finalProgress, 'DIMENSION_MISMATCH');
      } else {
        this.finish(target.scopeId, target.jobId, lease, 'succeeded', finalProgress, null);
      }
      return this.get(target.scopeId, target.jobId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'VERSION_CONFLICT') return this.get(target.scopeId, target.jobId);
      const { code } = classifyFailure(error);
      try {
        this.finish(target.scopeId, target.jobId, lease, 'failed', currentProgress(), code);
      } catch {
        /* 已被取消或租约已转移，保留新状态 */
      }
      return this.get(target.scopeId, target.jobId);
    } finally {
      activeProcessIndexJobs = Math.max(0, activeProcessIndexJobs - 1);
      heartbeat();
    }
  }
}
