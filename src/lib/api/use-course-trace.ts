'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './client';
import { useDrafts, useHistory, useJobs } from './hooks';
import { queryKeys } from './queries';
import { mergeTraces, summarizeTrace, type TraceView } from '@/lib/trace';
import type { JobView } from './types';

/**
 * 一门课的全部生成轨迹：课程方案任务（确认它的草稿记录的 generationJobId）
 * 加上本会话课件、题组任务（任务结果指向会话里的活动）。合并后用于书带与「生成过程」。
 */
export function useCourseTrace(courseId: string, sessionId: string | undefined) {
  const jobs = useJobs();
  const drafts = useDrafts();
  const history = useHistory(sessionId);
  const planJobId = drafts.data?.find(d => d.confirmed?.courseId === courseId)?.generationJobId ?? null;
  const runIds = useMemo(() => new Set((history.data ?? []).map(r => r.runId)), [history.data]);
  const contentJobs = useMemo(
    () => (jobs.data ?? []).filter(j => (j.kind === 'lesson' || j.kind === 'question_set') && runIds.has(resultId(j) ?? '')),
    [jobs.data, runIds],
  );
  const ids = [...(planJobId ? [planJobId] : []), ...contentJobs.map(j => j.jobId)];
  const traces = useQueries({
    queries: ids.map(id => ({ queryKey: queryKeys.trace(id), queryFn: () => api<TraceView>(`/jobs/${encodeURIComponent(id)}/trace`), staleTime: 60_000 })),
  });
  // 合并只是拼数组，每次渲染重算即可
  const merged = mergeTraces(traces.map(t => t.data));
  // 「课件出处」只计课件任务采用的引用（不含方案与题组）
  const lessonIds = new Set(contentJobs.filter(j => j.kind === 'lesson').map(j => j.jobId));
  const lessonSummary = summarizeTrace(mergeTraces(traces.filter((_, i) => lessonIds.has(ids[i])).map(t => t.data)));
  const lessonCites = lessonSummary.perSource.reduce((n, s) => n + new Set(s.cites).size, 0);
  return {
    planJobId,
    summary: summarizeTrace(merged),
    lessonCites,
    isPending: jobs.isPending || drafts.isPending || traces.some(t => t.isPending),
    error: jobs.error ?? drafts.error ?? traces.find(t => t.error)?.error ?? null,
  };
}

function resultId(job: JobView): string | null {
  const result = job.result as { id?: unknown } | null;
  return typeof result?.id === 'string' ? result.id : null;
}
