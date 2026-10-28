'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { api } from '@/lib/api/client';
import { queryKeys, useMode } from '@/lib/api/queries';
import { useJobStream } from '@/lib/api/use-job-stream';
import { useModelKey } from '@/lib/stores/model-key';
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, sourceDisplayName } from '@/lib/labels';
import { describeStep, summarizeTrace, type TraceView } from '@/lib/trace';
import { cn, formatClock, formatCount, formatDuration } from '@/lib/utils';
import type { JobView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm';
import { Panel } from '@/components/ui/panel';
import { BlockError } from '@/components/states/block-states';
import { Tape } from '@/components/zhupi/tape';

const RUNNING = new Set(['queued', 'running']);

/**
 * 生成过程：Agent 在读教材哪里、提交了什么、哪里校验没过又自动修正。
 * 实时进度来自 SSE；轨迹（书带与读取范围）每收到 5 个事件或任务结束时刷新一次。
 */
export function GenerationView({ jobId, title = '正在生成课程方案', compact = false, onFinished }: {
  jobId: string;
  title?: string;
  compact?: boolean;
  onFinished?: (job: JobView) => void;
}) {
  const client = useQueryClient();
  const mode = useMode();
  const modelKey = useModelKey(state => state.config);
  const stream = useJobStream(jobId);
  const initial = useQuery({ queryKey: queryKeys.job(jobId), queryFn: () => api<JobView>(`/jobs/${encodeURIComponent(jobId)}`) });
  const job = stream.job ?? initial.data ?? null;
  const running = !!job && RUNNING.has(job.status);
  const bucket = Math.floor(stream.events.length / 5);
  const trace = useQuery({
    queryKey: [...queryKeys.trace(jobId), bucket, job?.status],
    queryFn: () => api<TraceView>(`/jobs/${encodeURIComponent(jobId)}/trace`),
    placeholderData: previous => previous,
  });
  const summary = useMemo(() => summarizeTrace(trace.data), [trace.data]);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const notified = useRef(false);

  useEffect(() => {
    if (job && !RUNNING.has(job.status) && !notified.current) {
      notified.current = true;
      onFinished?.(job);
    }
    if (job && RUNNING.has(job.status)) notified.current = false;
  }, [job, onFinished]);

  const started = stream.events[0]?.createdAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const last = stream.events.at(-1)?.createdAt;
  const elapsed = started ? (running ? now : Date.parse(last ?? started)) - Date.parse(started) : 0;

  async function control(action: 'cancel' | 'resume') {
    setBusy(true);
    setActionError(null);
    try {
      const view = await api<JobView>(`/jobs/${encodeURIComponent(jobId)}/${action}`, { method: 'POST', body: {}, modelHeader: action === 'resume' });
      client.setQueryData(queryKeys.job(jobId), view);
      notified.current = false;
      void client.invalidateQueries({ queryKey: ['draft'] });
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  const titleOf = (sourceId: string) => {
    const source = summary.perSource.find(s => s.sourceId === sourceId);
    return source ? sourceDisplayName(source.title, sourceId) : '资料';
  };
  const needsKey = job?.error?.code === 'MODEL_KEY_REQUIRED';
  const online = mode.data?.mode === 'online';
  const lines = summary.steps.length
    ? [...summary.steps].reverse().slice(0, compact ? 8 : 40).map((step, index) => ({ key: `s${index}`, at: step.at ? new Date(step.at).toISOString() : undefined, text: describeStep(step, titleOf), ok: step.ok, error: step.error }))
    : [...stream.events].reverse().slice(0, compact ? 8 : 40).map(e => ({ key: `e${e.cursor}`, at: e.createdAt, text: e.message, ok: !/失败|问题/.test(e.message), error: undefined as string | undefined }));

  return (
    <div className={cn('grid gap-6', !compact && 'mt-6')}>
      <Panel
        title={title}
        description={job && (
          <span aria-live="polite">
            {JOB_KIND_LABEL[job.kind] ?? job.kind} · {JOB_STATUS_LABEL[job.status] ?? job.status}
            {job.status === 'running' && job.stage && ` · ${job.stage}`}
            {elapsed > 0 && ` · 已用 ${formatDuration(elapsed)}`}
            {job.attempts > 1 && ` · 第 ${job.attempts} 次执行`}
          </span>
        )}
        actions={
          <>
            {running && (
              <ConfirmButton
                size="sm"
                title="停止生成？"
                description="已经通过验收的部分会保留，之后可以继续；正在进行的那次模型请求可能已经计费。"
                confirmLabel="停止"
                danger
                onConfirm={() => control('cancel')}
              >
                <Square aria-hidden />停止生成
              </ConfirmButton>
            )}
            {job?.resumable && !running && (
              <Button size="sm" variant="primary" disabled={busy || (online && !modelKey)} onClick={() => void control('resume')}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}继续任务
              </Button>
            )}
          </>
        }
      >
        <dl className="mt-5 grid grid-cols-5 max-md:grid-cols-2 max-md:gap-y-4">
          {[
            ['读取原文', summary.reads, '次'],
            ['搜索资料', summary.searches, '次'],
            ['通过验收的提交', summary.submits, '项'],
            ['校验后自动修正', summary.fixes, '次'],
            ['模型请求', summary.requests, '次'],
          ].map(([label, value, unit], index) => (
            <div key={label as string} className={cn('px-5 first:pl-0', index > 0 && 'border-l border-line max-md:[&:nth-child(odd)]:border-l-0 max-md:[&:nth-child(odd)]:pl-0')}>
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="mt-1 text-[1.75rem] leading-tight tabular-nums">{formatCount(value as number)}<small className="ml-1 text-base text-muted">{unit}</small></dd>
            </div>
          ))}
        </dl>
        {job?.status === 'failed' && (
          <div role="alert" className="mt-5 rounded-[var(--radius-control)] bg-zhu-tint px-4 py-3 text-base">
            <p className="font-medium text-zhu-deep">{needsKey ? '服务器已重启，模型 Key 只保存在你的浏览器里' : '生成没有完成'}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-ink-soft">
              {needsKey ? (online && !modelKey ? '先在设置中填写模型 Key，再回来点“继续任务”。已通过验收的部分不会重复生成。' : '确认设置中的 Key 后点“继续任务”，已通过验收的部分不会重复生成。') : job.error?.message}
            </p>
            {needsKey && online && !modelKey && <Link href="/settings" className="mt-2 inline-block font-medium underline underline-offset-4">去设置填写模型 Key</Link>}
          </div>
        )}
        {job?.status === 'cancelled' && <p className="mt-5 text-base text-ink-soft">已停止。通过验收的部分已经保存，可以返回编辑后重新生成。</p>}
        <BlockError className="mt-4" error={actionError ?? initial.error} />
      </Panel>

      <div className={cn('grid items-start gap-6', !compact && 'grid-cols-[minmax(0,1fr)_26rem] max-xl:grid-cols-1')}>
        <Panel title="执行记录" description={stream.connected ? '实时更新' : running ? '正在连接…' : undefined}>
          {lines.length === 0 ? <p className="mt-4 text-base text-muted">任务已排队，Agent 马上开始。</p> : (
            <ol className="mt-4" aria-live="polite" aria-relevant="additions">
              {lines.map((line, index) => (
                <li key={line.key} className={cn('row-enter grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-t border-rule py-2 text-base first:border-t-0', index === 0 && running && 'text-zhu')}>
                  <time className="text-sm tabular-nums text-muted">{line.at ? formatClock(line.at) : ''}</time>
                  <span className="min-w-0">
                    {!line.ok && <span className="mr-1.5 text-zhu" aria-hidden>✗</span>}
                    {!line.ok && <span className="sr-only">校验未通过：</span>}
                    {line.text}
                    {line.error && <span className="mt-0.5 block text-sm text-muted">{line.error}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        {!compact && (
          <Panel title="Agent 在书里读了哪里" description="灰色为读过的段落，朱批细线为被采用的出处。">
            {summary.perSource.length === 0 ? <p className="mt-4 text-base text-muted">还没有读取记录。</p> : (
              <ul className="mt-4 grid grid-cols-1 gap-5">
                {summary.perSource.map(source => (
                  <li key={source.sourceId} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 text-base">
                      <span className="min-w-0 truncate font-medium">{sourceDisplayName(source.title, source.sourceId)}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted">{formatCount(source.paragraphs)} 段 · 出处 {new Set(source.cites).size}</span>
                    </div>
                    <Tape className="mt-2" total={source.paragraphs} reads={source.reads} cites={source.cites} label={sourceDisplayName(source.title, source.sourceId)} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
