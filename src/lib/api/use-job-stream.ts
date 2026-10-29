'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { API_BASE, api } from './client';
import { queryKeys } from './queries';
import type { JobEvent, JobView } from './types';

const TERMINAL = new Set(['waiting_user', 'succeeded', 'failed', 'cancelled']);

/**
 * 任务进度：优先用 SSE（/jobs/{id}/stream），浏览器断线时自动重连并携带 Last-Event-ID；
 * 不支持 EventSource 时退回每 2 秒轮询。任务结束后刷新草稿、会话、任务等缓存。
 */
export function useJobStream(jobId: string | null | undefined): { job: JobView | null; events: JobEvent[]; connected: boolean } {
  const client = useQueryClient();
  const [job, setJob] = useState<JobView | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setJob(null);
    setEvents([]);
    if (!jobId) return;
    let stopped = false;
    const append = (incoming: JobEvent[]) => setEvents(previous => {
      const seen = new Set(previous.map(e => e.cursor));
      const fresh = incoming.filter(e => !seen.has(e.cursor));
      return fresh.length ? [...previous, ...fresh].sort((a, b) => a.cursor - b.cursor) : previous;
    });
    const finish = () => {
      for (const key of [queryKeys.jobs(), queryKeys.job(jobId), queryKeys.trace(jobId), ['draft'], ['session'], ['run'], ['courses'], ['progress']]) {
        void client.invalidateQueries({ queryKey: key });
      }
    };

    if (typeof EventSource !== 'undefined') {
      const source = new EventSource(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/stream`);
      source.addEventListener('open', () => setConnected(true));
      source.addEventListener('progress', event => {
        try { append([JSON.parse((event as MessageEvent).data) as JobEvent]); } catch { /* 忽略格式错误的事件 */ }
      });
      source.addEventListener('job', event => {
        try { setJob(JSON.parse((event as MessageEvent).data) as JobView); } catch { /* 同上 */ }
      });
      source.addEventListener('end', () => { source.close(); setConnected(false); finish(); });
      source.onerror = () => setConnected(false);
      return () => { stopped = true; source.close(); };
    }

    // 降级：轮询任务与事件
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const [view, batch] = await Promise.all([
          api<JobView>(`/jobs/${encodeURIComponent(jobId)}`),
          api<JobEvent[]>(`/jobs/${encodeURIComponent(jobId)}/events?after=${cursor}`),
        ]);
        if (stopped) return;
        setJob(view);
        append(batch);
        cursor = batch.at(-1)?.cursor ?? cursor;
        if (TERMINAL.has(view.status)) { finish(); return; }
      } catch { /* 网络抖动时继续轮询 */ }
      if (!stopped) timer = setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [jobId, client]);

  return { job, events, connected };
}
