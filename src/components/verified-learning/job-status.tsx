'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api, type JobView } from '@/lib/verified-learning/client';
import ErrorBox from '@/components/verified-learning/error-box';
import { usePolling } from '@/components/verified-learning/use-polling';

export const JOB_KIND_LABEL: Record<string, string> = {
  import: '教材导入',
  curriculum: '课程生成',
  lesson: '课件生成',
  question_set: '题组生成',
};

function terminal(job: JobView | null): boolean {
  return !!job && ['waiting_user', 'succeeded', 'failed', 'cancelled'].includes(job.status);
}

/**
 * 任务状态行：2 秒轮询直到终态。
 * onDone 在任务首次到达终态时触发一次（用于刷新关联数据）。
 */
export default function JobStatus({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone?: (job: JobView) => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [events, setEvents] = useState<{ cursor: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function control(action: 'resume' | 'cancel') {
    if (busy) return;
    if (action === 'resume' && !window.confirm('继续已保存的Agent任务；中断时未收到结果的模型请求可能再次产生费用。继续？')) return;
    setBusy(true); setError(null);
    try {
      const updated = await api<JobView>(`/jobs/${jobId}/${action}`, 'POST', {});
      notified.current = false; setJob(updated);
      if (terminal(updated)) { notified.current = true; onDoneRef.current?.(updated); }
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  const notified = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const poll = useCallback(async () => {
    try {
      const view = await api<JobView>(`/jobs/${jobId}`);
      setJob(view);
      setError(null);
      try { setEvents(await api<{ cursor: number; message: string }[]>(`/jobs/${jobId}/events?after=0`)); } catch { /* 状态主请求仍可用，保留已有事件 */ }
      if (terminal(view) && !notified.current) {
        notified.current = true;
        onDoneRef.current?.(view);
      }
      return !terminal(view);
    } catch (e) {
      setError(e);
      return true;
    }
  }, [jobId]);

  usePolling(poll, !terminal(job));

  if (error && !job) return <li><ErrorBox error={error} /></li>;
  if (!job) {
    return (
      <li className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-foreground" />
        加载任务状态…
      </li>
    );
  }

  const running = job.status === 'queued' || job.status === 'running';
  return (
    <li className="rounded-md border border-border px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        {running ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin text-accent" />
        ) : job.status === 'succeeded' || job.status === 'waiting_user' ? (
          <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
        ) : (
          <XCircle aria-hidden className="h-4 w-4 text-danger" />
        )}
        <span className="font-medium">{JOB_KIND_LABEL[job.kind] ?? job.kind}</span>
        <span className="text-muted-foreground" role="status" aria-live="polite">
          {job.status === 'queued' && '排队中'}
          {job.status === 'running' && (job.stage || '进行中')}
          {job.status === 'waiting_user' && '方案已生成，等待确认'}
          {job.status === 'succeeded' && '已完成'}
          {job.status === 'failed' && '失败'}
          {job.status === 'cancelled' && '已取消'}
        </span>
        {job.attempts > 1 && (
          <span className="text-xs text-muted-foreground">第 {job.attempts} 次尝试</span>
        )}
      </div>
      {events.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看Agent执行进度</summary><ol className="mt-2 space-y-1">{events.slice(-8).map(event => <li key={event.cursor}>{event.message}</li>)}</ol></details>}
      <div className="mt-2 flex gap-3">
        {running && <button type="button" disabled={busy} onClick={() => void control('cancel')} className="text-xs text-danger underline">停止生成</button>}
        {job.resumable && job.kind !== 'import' && <button type="button" disabled={busy} onClick={() => void control('resume')} className="text-xs text-accent underline">继续Agent任务</button>}
      </div>
      <ErrorBox error={error} />
      {job.error && (
        <p role="alert" className="mt-1 whitespace-pre-wrap break-words text-danger">
          {job.error.message}
        </p>
      )}
    </li>
  );
}
