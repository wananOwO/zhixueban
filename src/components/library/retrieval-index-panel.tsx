'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2, RefreshCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { BlockError } from '@/components/states/block-states';

export interface RetrievalIndexStatus {
  status: 'none' | 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
  profileId: string | null;
  ready: number;
  failed: number;
  total: number;
  jobId: string | null;
  usable: boolean;
  configured: boolean;
  model: string | null;
}

const STATUS_TEXT: Record<RetrievalIndexStatus['status'], string> = {
  none: '尚未建立语义索引',
  queued: '索引任务已排队',
  running: '正在建立语义索引',
  waiting_user: '本次授权的批次已用完，可以继续',
  succeeded: '索引已完成',
  failed: '索引没有完成',
  cancelled: '索引已停止',
};

/**
 * 教材详情的语义索引面板：显式确认后才建立（会产生 Embedding 费用），
 * 失败只影响语义检索，关键词检索照常可用。
 */
export function RetrievalIndexPanel({
  status, onStart, onResume, onCancel, onRetry, pending, error,
}: {
  status: RetrievalIndexStatus | undefined;
  onStart: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!status) return <Panel title="语义索引"><p className="mt-4 text-base text-muted">正在读取索引状态</p></Panel>;
  const active = status.status === 'running' || status.status === 'queued';
  const percent = status.total > 0 ? Math.round((status.ready / status.total) * 100) : 0;
  return (
    <Panel
      title="语义索引"
      description="关键词检索不需要索引；建立语义索引后才能按意思检索原文。索引会把这本教材的段落发送给所选的 Embedding 服务。"
    >
      <p className="mt-4 text-base" role="status" aria-live="polite">
        {STATUS_TEXT[status.status]}
        {status.model && <span className="ml-2 text-muted">{status.model}</span>}
        {status.status !== 'none' && <span className="ml-2 tabular-nums text-muted">{status.ready} / {status.total} 段</span>}
      </p>
      {active && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={status.total} aria-valuenow={status.ready} aria-label="索引进度" className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-raised">
          <span className="block h-full bg-zhu transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      )}
      {status.status === 'succeeded' && status.usable && <p className="mt-2 text-sm text-muted">语义检索已可用，引用与段号保持不变。</p>}
      {status.status === 'failed' && (
        <div role="alert" className="mt-3 rounded-[var(--radius-control)] bg-zhu-tint px-3.5 py-2.5 text-base">
          索引失败，本教材仍可用关键词检索。
          {status.failed > 0 && <span className="ml-1 tabular-nums">{status.failed} 段未完成</span>}
        </div>
      )}
      <BlockError className="mt-3" error={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        {!status.configured && <p className="text-base text-ink-soft">未配置 Embedding 模型，请在<Link href="/settings" className="ml-1 underline underline-offset-4 hover:text-ink">去设置</Link>填写后回来建立索引。</p>}
        {status.configured && (status.status === 'none' || status.status === 'cancelled') && (
          <Button variant="primary" disabled={pending} onClick={() => setConfirming(true)}><RefreshCw aria-hidden />建立语义索引</Button>
        )}
        {active && <Button disabled={pending} onClick={onCancel}><Square aria-hidden />停止索引</Button>}
        {status.status === 'failed' && <Button disabled={pending} onClick={onRetry}><RefreshCw aria-hidden />重试索引</Button>}
        {status.status === 'waiting_user' && <Button disabled={pending} onClick={onResume}><RefreshCw aria-hidden />继续索引</Button>}
      </div>
      {confirming && (
        <fieldset aria-label="确认建立语义索引" className="mt-4 grid gap-3 rounded-[var(--radius-control)] bg-raised px-4 py-3">
          <p className="text-base">将把 {status.total > 0 ? `${status.total} 个段落` : '这本教材的段落'}发送给所选 Embedding 服务，费用由你的模型账户承担。索引失败不影响关键词检索。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending} onClick={() => { setConfirming(false); onStart(); }}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}确认建立</Button>
            <Button onClick={() => setConfirming(false)}>先不建立</Button>
          </div>
        </fieldset>
      )}
    </Panel>
  );
}