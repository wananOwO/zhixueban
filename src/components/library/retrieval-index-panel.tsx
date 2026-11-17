'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, Square } from 'lucide-react';
import { formatCount } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { BlockError } from '@/components/states/block-states';

export interface RetrievalIndexStatus {
  status: 'none' | 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
  profileId: string | null;
  ready: number;
  failed: number;
  total: number;
  paragraphCount?: number;
  charCount?: number;
  baseUrl?: string | null;
  jobId: string | null;
  usable: boolean;
  resumable?: boolean;
  leaseExpired?: boolean;
  error?: { code: string; message: string; retryable: boolean } | null;
  configured: boolean;
  model: string | null;
}

const STATUS_TEXT: Record<RetrievalIndexStatus['status'], string> = {
  none: '尚未建立语义索引',
  queued: '索引任务已排队',
  running: '正在建立语义索引',
  waiting_user: '本次授权的批次已暂停，确认后可继续',
  succeeded: '索引已完成',
  failed: '索引没有完成',
  cancelled: '索引已停止',
};

/**
 * 教材详情的语义索引面板：
 * - 显式确认后才建立（展示段落数、字符数、供应商地址、费用承担与隐私说明）；
 * - 服务重启导致租约过期时明确显示“已中断可继续”，不伪装仍在运行；
 * - 失败或未建索引时关键词检索始终照常可用。
 */
export function RetrievalIndexPanel({
  status,
  onStart,
  onRebuild,
  onResume,
  onCancel,
  onRetry,
  pending,
  error,
}: {
  status: RetrievalIndexStatus | undefined;
  onStart: () => void;
  onRebuild?: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [confirmMode, setConfirmMode] = useState<'build' | 'rebuild' | null>(null);
  if (!status) return <Panel title="语义索引"><p className="mt-4 text-base text-muted">正在读取索引状态</p></Panel>;

  const leaseExpired = status.status === 'running' && status.leaseExpired === true;
  const active = (status.status === 'running' || status.status === 'queued') && !leaseExpired;
  const percent = status.total > 0 ? Math.round((status.ready / status.total) * 100) : 0;
  const displayParagraphs = status.paragraphCount ?? status.total;
  const statusLabel = leaseExpired ? '索引因服务重启中断，可继续剩余部分' : STATUS_TEXT[status.status];

  return (
    <Panel
      title="语义索引"
      description="关键词检索不需要索引；建立语义索引后才能按意思检索原文。索引会把这本教材的段落发送给所选的 Embedding 服务。"
    >
      <p className="mt-4 flex flex-wrap items-center gap-1.5 text-base" role="status" aria-live="polite">
        {status.status === 'succeeded' && status.usable ? (
          <CheckCircle2 className="size-4 shrink-0 text-ink" aria-hidden />
        ) : active ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-zhu" aria-hidden />
        ) : status.status === 'failed' || leaseExpired ? (
          <AlertTriangle className="size-4 shrink-0 text-zhu" aria-hidden />
        ) : (
          <Clock className="size-4 shrink-0 text-muted" aria-hidden />
        )}
        <span>{statusLabel}</span>
        {status.model && <span className="ml-1 text-muted">{status.model}</span>}
        {status.status !== 'none' && status.total > 0 && (
          <span className="ml-1 tabular-nums text-muted">{status.ready} / {status.total} 块</span>
        )}
      </p>

      {active && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(1, status.total)} aria-valuenow={status.ready} aria-label="索引进度" className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-raised">
          <span className="block h-full bg-zhu transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      )}

      {status.status === 'succeeded' && status.usable && (
        <p className="mt-2 text-sm text-muted">语义检索已可用，引用与段号保持不变。</p>
      )}

      {(status.status === 'failed' || leaseExpired) && (
        <div role="alert" className="mt-3 rounded-[var(--radius-control)] bg-zhu-tint px-3.5 py-2.5 text-base">
          {status.error?.message ?? '语义索引暂不可用，当前使用关键词检索。'}
          {status.failed > 0 && <span className="ml-1 tabular-nums">（{status.failed} 块未完成，关键词检索照常可用）</span>}
        </div>
      )}

      {status.status === 'waiting_user' && status.error?.message && (
        <p className="mt-2 text-sm text-ink-soft">{status.error.message}</p>
      )}

      <BlockError className="mt-3" error={error} />

      <div className="mt-4 flex flex-wrap gap-3">
        {!status.configured && (
          <p className="text-base text-ink-soft">
            未配置 Embedding 模型，当前使用关键词检索。请在
            <Link href="/settings" className="ml-1 underline underline-offset-4 hover:text-ink">去设置</Link>
            填写后回来建立索引。
          </p>
        )}
        {status.configured && (status.status === 'none' || status.status === 'cancelled') && (
          <Button variant="primary" disabled={pending} onClick={() => setConfirmMode('build')}>
            <RefreshCw aria-hidden />建立语义索引
          </Button>
        )}
        {active && (
          <Button disabled={pending} onClick={onCancel}>
            <Square aria-hidden />停止索引
          </Button>
        )}
        {status.configured && status.status === 'failed' && (
          <Button disabled={pending} onClick={onRetry}>
            <RefreshCw aria-hidden />重试索引
          </Button>
        )}
        {status.configured && (status.status === 'waiting_user' || leaseExpired) && (
          <Button variant="primary" disabled={pending} onClick={onResume}>
            <RefreshCw aria-hidden />继续索引
          </Button>
        )}
        {status.configured && status.status === 'succeeded' && onRebuild && (
          <Button disabled={pending} onClick={() => setConfirmMode('rebuild')}>
            <RefreshCw aria-hidden />重建索引
          </Button>
        )}
      </div>

      {confirmMode && (
        <fieldset aria-label="确认建立语义索引" className="mt-4 grid gap-3 rounded-[var(--radius-control)] bg-raised px-4 py-3">
          <div className="grid gap-1 text-sm text-ink-soft">
            <p className="text-base font-medium text-ink">
              {confirmMode === 'rebuild' ? '确认重新生成全部语义向量？' : '确认将教材段落发送给所选 Embedding 服务？'}
            </p>
            <p>
              待发送范围：{displayParagraphs > 0 ? `${formatCount(displayParagraphs)} 个段落` : '本教材全部非空段落'}
              {typeof status.charCount === 'number' && status.charCount > 0 ? `（共 ${formatCount(status.charCount)} 字）` : ''}
            </p>
            {status.baseUrl && <p className="break-all">供应商地址：{status.baseUrl}</p>}
            <p>费用与隐私说明：调用费用由你配置的模型账户承担；正文会按批发送至上述服务，不会公开上传到其他位置。索引失败不影响关键词检索。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                const mode = confirmMode;
                setConfirmMode(null);
                if (mode === 'rebuild' && onRebuild) onRebuild();
                else onStart();
              }}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}确认建立
            </Button>
            <Button onClick={() => setConfirmMode(null)}>先不建立</Button>
          </div>
        </fieldset>
      )}
    </Panel>
  );
}
