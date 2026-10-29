'use client';

import Link from 'next/link';
import { ACTIVITY_LABEL } from '@/lib/labels';
import { cn, formatShortTime } from '@/lib/utils';
import type { CoursePointView, HistoryRunItem } from '@/lib/api/types';

export const RUN_STATUS_LABEL: Record<string, string> = { completed: '已完成', ready: '进行中', generating: '生成中', abandoned: '已放弃' };

/** 活动标题：「知识点练习 · 运行程序与 print()」 */
export function runTitle(run: Pick<HistoryRunItem, 'activity'>, points: CoursePointView[]): string {
  const names = run.activity.knowledgePointIds.map(id => points.find(p => p.knowledgePointId === id)?.title ?? id);
  return `${ACTIVITY_LABEL[run.activity.kind] ?? '学习活动'} · ${names.join('、') || '整门课'}`;
}

/** 学习历史时间线：活动类型、知识点、状态、时间；点开只读回看 */
export function HistoryList({ sessionId, runs, points, selected, className }: {
  sessionId: string;
  runs: HistoryRunItem[];
  points: CoursePointView[];
  selected?: string;
  className?: string;
}) {
  return (
    <ol className={cn('grid', className)}>
      {runs.map(run => (
        <li key={run.runId} className="border-t border-rule first:border-t-0">
          <Link
            href={`/learn/${encodeURIComponent(sessionId)}/history?run=${encodeURIComponent(run.runId)}`}
            aria-current={selected === run.runId ? 'page' : undefined}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 rounded-[var(--radius-control)] px-2 py-2.5 hover:bg-ground',
              selected === run.runId && 'bg-zhu-tint hover:bg-zhu-tint',
            )}
          >
            <span className="min-w-0 truncate font-medium">{runTitle(run, points)}</span>
            <time dateTime={run.createdAt} className="text-sm tabular-nums text-muted">{formatShortTime(run.createdAt)}</time>
            <span className="text-sm text-muted">{RUN_STATUS_LABEL[run.status] ?? run.status}{run.activity.questionCount > 0 && ` · ${run.activity.questionCount} 题`}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
