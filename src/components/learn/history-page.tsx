'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useBooks, useCourses, useDrafts, useHistory, useHistoryRun, useSession } from '@/lib/api/hooks';
import { courseTitle, outlinePoints } from '@/lib/course';
import { formatShortTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';
import { SourceDrawer, type SourceTarget } from '@/components/zhupi/source-drawer';
import { HistoryList, runTitle } from './history-list';
import { LessonArticle } from './lesson-article';
import { QuestionSet } from './question-set';

/** 历史回看：左侧时间线，右侧只读查看当时的课件与作答（已提交的题带答案与解析）。不改变学习进度。 */
export function HistoryPage({ sessionId, runId }: { sessionId: string; runId?: string }) {
  const session = useSession(sessionId);
  const history = useHistory(sessionId);
  const courses = useCourses();
  const drafts = useDrafts();
  const books = useBooks();
  const course = courses.data?.find(c => c.versionId === session.data?.session.courseVersionId);
  const title = course ? courseTitle(course, drafts.data) : '课程';
  const points = outlinePoints(session.data?.version.outline);
  const selected = runId ?? history.data?.[0]?.runId;
  const detail = useHistoryRun(sessionId, selected);
  const item = history.data?.find(r => r.runId === selected);
  const titles = useMemo(() => Object.fromEntries((books.data ?? []).map(b => [b.bookId, b.title])), [books.data]);
  const [drawer, setDrawer] = useState<SourceTarget | null>(null);

  return (
    <>
      <PageHeader
        crumbs={[{ href: '/courses', label: '我的课程' }, ...(session.data ? [{ href: `/courses/${encodeURIComponent(session.data.session.courseId)}`, label: title }] : []), { label: '历史回看' }]}
        title="历史回看"
        description="当时的课件与作答，只读。这里的操作不会改变学习进度。"
        actions={<Button asChild variant="primary"><Link href={`/learn/${encodeURIComponent(sessionId)}`}>继续学习<ArrowRight aria-hidden /></Link></Button>}
      />
      <BlockError className="mt-4" error={session.error ?? history.error} onRetry={() => { void session.refetch(); void history.refetch(); }} />
      <div className="mt-6 grid grid-cols-[22rem_minmax(0,1fr)] items-start gap-6 max-lg:grid-cols-1">
        <Panel title="学习记录" description={history.data?.length ? `${history.data.length} 次活动，最新的在上` : undefined} className="sticky top-4 max-lg:static">
          {history.isPending ? <BlockLoading className="mt-3" lines={4} /> : !history.data?.length ? (
            <BlockEmpty className="mt-3" title="还没有学习记录" />
          ) : (
            <HistoryList className="mt-3" sessionId={sessionId} runs={history.data} points={points} selected={selected} />
          )}
        </Panel>
        <section aria-label="回看内容" className="min-w-0 rounded-[var(--radius-paper)] bg-paper px-12 pb-8 pt-8 max-xl:px-8 max-md:px-4 max-md:pt-5">
          {!selected ? <BlockEmpty title="选一条学习记录查看" /> : detail.isPending ? <BlockLoading lines={8} label="正在读取" /> : detail.error ? (
            <BlockError error={detail.error} onRetry={() => void detail.refetch()} />
          ) : detail.data && (
            <>
              <h2 className="font-serif text-h2 font-bold">{item ? runTitle(item, points) : '学习活动'}</h2>
              {item && <p className="mt-1 text-sm text-muted">{formatShortTime(item.createdAt)}{item.activity.questionCount > 0 && ` · ${item.activity.questionCount} 题`}</p>}
              {detail.data.content ? (
                <div className="mt-6">
                  <LessonArticle markdown={detail.data.content.markdown} citations={detail.data.content.citations} titles={titles} margin variant="history" onOpen={setDrawer} />
                </div>
              ) : detail.data.questions.length > 0 ? (
                <div className="mt-6 -mx-6 bg-ground px-6 py-5 max-md:-mx-4 max-md:px-4">
                  <QuestionSet runId={detail.data.runId} questions={detail.data.questions} readOnly />
                </div>
              ) : (
                <BlockEmpty className="mt-4" title="这次活动没有保存内容">可能在生成完成前就被放弃了。</BlockEmpty>
              )}
            </>
          )}
        </section>
      </div>
      <SourceDrawer target={drawer} onClose={() => setDrawer(null)} />
    </>
  );
}
