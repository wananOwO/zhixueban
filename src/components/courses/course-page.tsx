'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useBooks, useCourses, useDrafts, useHistory, useProgress, useSession } from '@/lib/api/hooks';
import { useCourseTrace } from '@/lib/api/use-course-trace';
import { courseTitle, describeNext, outlinePoints, toRoadmapPoints } from '@/lib/course';
import { isWebSource, sourceDisplayName } from '@/lib/labels';
import { formatCount, formatShortTime } from '@/lib/utils';
import type { CourseListItem, CoursePointView, HistoryRunItem, ProgressView, SessionView } from '@/lib/api/types';
import type { TraceSummary } from '@/lib/trace';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';
import { Roadmap } from '@/components/zhupi/roadmap';
import { GradeMark } from '@/components/zhupi/grade-mark';
import { Tape } from '@/components/zhupi/tape';
import { GenerationView } from '@/components/drafts/generation-view';
import { HistoryList, runTitle } from '@/components/learn/history-list';
import { NextStep } from './next-step';
import { NotesTab } from './notes-tab';

const TABS = [
  ['roadmap', '路线图'],
  ['notes', '笔记'],
  ['history', '历史回看'],
  ['sources', '资料来源'],
  ['generation', '生成过程'],
] as const;
type Tab = (typeof TABS)[number][0];

/** 课程主页：先修路线图为主体，下方下一步 / 最近活动 / 资料来源；其余视图放在标签页 */
export function CoursePage({ courseId }: { courseId: string }) {
  const searchParams = useSearchParams();
  const versionId = searchParams.get('versionId');
  const courses = useCourses();
  const drafts = useDrafts();
  const versions = courses.data?.filter(c => c.courseId === courseId) ?? [];
  // 缺省取当前版本（active），没有则取最新一版
  const course = versions.find(c => c.versionId === versionId) ?? versions.find(c => c.status === 'active') ?? versions[0];
  const requestedTab = searchParams.get('tab');
  const tab: Tab = TABS.some(([id]) => id === requestedTab) ? requestedTab as Tab : 'roadmap';

  const changeTab = (value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value === 'roadmap') params.delete('tab'); else params.set('tab', value);
    const query = params.toString();
    // 只改变本地视图，不触发 RSC 往返；保留版本、其他参数与当前锚点。
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  };

  if (courses.isPending) return <><PageHeader crumbs={[{ href: '/courses', label: '我的课程' }]} title="课程" /><Panel className="mt-6"><BlockLoading lines={8} label="正在读取课程" /></Panel></>;
  if (courses.error) return <><PageHeader crumbs={[{ href: '/courses', label: '我的课程' }]} title="课程" /><BlockError className="mt-6" error={courses.error} onRetry={() => void courses.refetch()} /></>;
  if (!course) {
    return (
      <>
        <PageHeader crumbs={[{ href: '/courses', label: '我的课程' }]} title="没有找到这门课程" />
        <Panel className="mt-6"><BlockEmpty title="课程不存在或已被删除" action={<Button asChild><Link href="/courses">返回我的课程</Link></Button>} /></Panel>
      </>
    );
  }
  return <CourseBody course={course} title={courseTitle(course, drafts.data)} tab={tab} onTab={changeTab} />;
}

function CourseBody({ course, title, tab, onTab }: { course: CourseListItem; title: string; tab: Tab; onTab: (tab: string) => void }) {
  const router = useRouter();
  const session = useSession(course.sessionId);
  const progress = useProgress(course.versionId);
  const history = useHistory(course.sessionId);
  const trace = useCourseTrace(course.courseId, course.sessionId);
  const points = outlinePoints(course.snapshot.outline);
  const next = session.data ? describeNext(session.data) : null;
  const learnHref = course.sessionId ? `/learn/${course.sessionId}` : null;
  const lastLesson = history.data?.find(r => r.activity.kind === 'lesson');

  return (
    <>
      <PageHeader
        crumbs={[{ href: '/courses', label: '我的课程' }, { label: title }]}
        title={title}
        description={
          <>
            {course.snapshot.goal && <>目标：{course.snapshot.goal}</>}
            {next && <>{course.snapshot.goal && ' · '}<span className="font-medium text-zhu">{next.title}</span></>}
          </>
        }
        actions={learnHref && (
          <>
            {lastLesson && <Button asChild><Link href={`/learn/${course.sessionId}/history?run=${encodeURIComponent(lastLesson.runId)}`}>回看课件</Link></Button>}
            <Button asChild variant="primary"><Link href={learnHref}>继续学习<ArrowRight aria-hidden /></Link></Button>
          </>
        )}
      />
      <Tabs value={tab} onValueChange={onTab} className="mt-5">
        <TabsList aria-label="课程视图">
          {TABS.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="roadmap">
          <RoadmapSection course={course} points={points} session={session.data} progress={progress.data} history={history.data} citeCount={trace.lessonCites} onOpen={id => learnHref && router.push(`${learnHref}?point=${encodeURIComponent(id)}`)} error={progress.error ?? session.error} onRetry={() => { void progress.refetch(); void session.refetch(); }} />
          <div className="mt-6 grid grid-cols-3 items-stretch gap-6 max-xl:grid-cols-2 max-md:grid-cols-1">
            {session.data ? <NextStep view={session.data} progress={progress.data} className="max-xl:col-span-2 max-md:col-span-1" /> : (
              <Panel className="max-xl:col-span-2 max-md:col-span-1" title="下一步">{course.sessionId ? <BlockLoading className="mt-3" lines={3} /> : <p className="mt-3 text-base text-muted">这个版本没有学习会话。</p>}</Panel>
            )}
            <Panel title="最近活动" className="flex flex-col">
              {history.isPending ? <BlockLoading className="mt-3" lines={3} /> : !history.data?.length ? (
                <BlockEmpty className="mt-3" title="还没有学习记录">开始学习后，课件和练习会按时间列在这里。</BlockEmpty>
              ) : (
                <ul className="mt-3">
                  {history.data.slice(0, 3).map(run => (
                    <li key={run.runId} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-rule py-2.5 first:border-t-0">
                      <span className="min-w-0">
                        <span className="block truncate">{runTitle(run, points)}</span>
                        <small className="block text-xs text-muted">{run.activity.questionCount > 0 ? `${run.activity.questionCount} 题` : '课件'} · {run.status === 'completed' ? '已完成' : '未完成'}</small>
                      </span>
                      <time dateTime={run.createdAt} className="text-sm tabular-nums text-muted">{formatShortTime(run.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
              {!!history.data?.length && <div className="mt-auto pt-4"><button type="button" onClick={() => onTab('history')} className="font-medium underline decoration-control underline-offset-4 hover:decoration-ink">查看全部历史</button></div>}
            </Panel>
            <Panel title="资料来源" description="灰色为 Agent 读过的范围，朱批细线为课件引用的段落" className="flex flex-col">
              <SourceTapes course={course} summary={trace.summary} pending={trace.isPending} limit={3} />
              <div className="mt-auto pt-4"><button type="button" onClick={() => onTab('sources')} className="font-medium underline decoration-control underline-offset-4 hover:decoration-ink">全部资料</button></div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-6">
          <NotesTab courseId={course.courseId} versionId={course.versionId} points={points} />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Panel title="历史回看" description="按时间倒序。点开只读查看当时的课件与作答（含答案与解析），不会改变学习进度。">
            {history.isPending ? <BlockLoading className="mt-3" lines={4} /> : !course.sessionId || !history.data?.length ? (
              <BlockEmpty className="mt-3" title="还没有学习记录" />
            ) : (
              <HistoryList className="mt-3" sessionId={course.sessionId} runs={history.data} points={points} />
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="sources" className="mt-6">
          <SourcesTab course={course} summary={trace.summary} pending={trace.isPending} />
        </TabsContent>

        <TabsContent value="generation" className="mt-6">
          {trace.planJobId ? <GenerationView jobId={trace.planJobId} title="课程方案的生成过程" /> : (
            <Panel title="生成过程"><BlockEmpty className="mt-3" title="没有找到这门课的方案生成记录">课程可能来自旧版本或示例数据。</BlockEmpty></Panel>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

/** 统计条 + 先修路线图（节点上是最近 5 题的批改标记） */
function RoadmapSection({ course, points, session, progress, history, citeCount, onOpen, error, onRetry }: {
  course: CourseListItem;
  points: CoursePointView[];
  session?: SessionView;
  progress?: ProgressView;
  history?: HistoryRunItem[];
  citeCount: number;
  onOpen: (id: string) => void;
  error: unknown;
  onRetry: () => void;
}) {
  const roadmapPoints = toRoadmapPoints(course.snapshot.outline);
  const evidence = Object.fromEntries(Object.entries(progress?.recent ?? {}).map(([id, list]) => [id, list.map(ok => (ok ? 'ok' : 'no') as 'ok' | 'no')]));
  const current = session ? describeNext(session).pointIds[0] : undefined;
  const targets = points.filter(p => p.role === 'target').length;
  // 已完成活动按类型拆分：取本会话历史里已完成的活动（同一活动只计一次）
  const completed = new Map((history ?? []).filter(r => r.status === 'completed').map(r => [r.activity.activityId, r.activity.kind]));
  const lessons = [...completed.values()].filter(kind => kind === 'lesson').length;
  const kpis: [string, React.ReactNode, React.ReactNode][] = [
    ['已验证掌握', progress ? progress.verifiedKnowledgePointIds.length : '—', `/ ${points.length} 个知识点`],
    ['已完成活动', progress ? progress.completedActivities : '—', history ? `课件 ${lessons} · 练习 ${completed.size - lessons}` : ''],
    ['计入证据的作答', progress?.evidenceQuestions ?? '—', progress ? `题 · 共作答 ${progress.attempts.total} 题` : ''],
    ['课件出处', citeCount, '处 · 可回查'],
  ];
  return (
    <section aria-labelledby="map-h" className="mt-6 rounded-[var(--radius-paper)] bg-paper px-7 py-6 max-md:px-4 max-md:py-5">
      <ul aria-label="课程进度" className="grid grid-cols-4 tabular-nums max-md:grid-cols-2 max-md:gap-y-4">
        {kpis.map(([label, value, unit], index) => (
          <li key={label} className={index === 0 ? 'pr-6' : 'border-l border-line px-6 max-md:[&:nth-child(odd)]:border-l-0 max-md:[&:nth-child(odd)]:pl-0 max-md:px-4'}>
            <span className="text-sm text-muted">{label}</span>
            <strong className="mt-1 block text-h1 font-normal leading-tight">{value}<small className="ml-1 text-base text-muted">{unit}</small></strong>
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id="map-h" className="font-serif text-h3 font-bold">先修路线图</h2>
          <p className="mt-0.5 text-sm text-muted">
            {targets} 个学习目标，{points.length - targets} 个先修知识点。把鼠标放到知识点上，可以看到学它之前要先学哪些；点击进入学习。
          </p>
        </div>
        <div aria-hidden className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted max-md:ml-0">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-[#8f8e89] bg-paper" />学习目标</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-[#dddcd7] bg-paper" />先修</span>
          <span className="inline-flex items-center gap-1.5"><GradeMark kind="ok" size="sm" />答对</span>
          <span className="inline-flex items-center gap-1.5"><GradeMark kind="no" size="sm" />答错</span>
          <span className="inline-flex items-center gap-1.5"><GradeMark kind="pending" size="sm" />最近 5 题中待作答</span>
        </div>
      </div>
      <BlockError className="mt-4" error={error} onRetry={onRetry} />
      {roadmapPoints.length === 0 ? <BlockEmpty className="mt-4" title="这个版本没有知识点" /> : (
        <Roadmap className="mt-3" points={roadmapPoints} evidence={evidence} current={current} onOpen={course.sessionId ? onOpen : undefined} />
      )}
    </section>
  );
}

function useSourceRows(course: CourseListItem, summary: TraceSummary) {
  const books = useBooks();
  const ids = (course.snapshot.sourceRevisions ?? []).map(r => r.sourceId);
  return ids.map(id => {
    const book = books.data?.find(b => b.bookId === id);
    const traced = summary.perSource.find(s => s.sourceId === id);
    const title = sourceDisplayName(book?.title ?? traced?.title ?? id, id);
    return { id, title, web: isWebSource(id), book, traced, cites: new Set(traced?.cites ?? []).size };
  });
}

/** 下方栏：只给引用最多的那份资料画书带，其余一行一份（同样张） */
function SourceTapes({ course, summary, pending, limit }: { course: CourseListItem; summary: TraceSummary; pending: boolean; limit: number }) {
  const rows = useSourceRows(course, summary);
  // 先列有书带数据的（读过或引用过），再按引用数排序
  const sorted = [...rows].sort((a, b) => Number(!!b.traced) - Number(!!a.traced) || b.cites - a.cites);
  if (pending && rows.every(r => !r.traced)) return <BlockLoading className="mt-3" lines={3} />;
  return (
    <ul className="mt-2">
      {sorted.slice(0, limit).map((row, index) => (
        <li key={row.id} className="min-w-0 border-t border-rule py-2.5 first:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-medium">{row.title}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted">
              {row.web ? '联网补充' : row.traced ? `${formatCount(row.traced.paragraphs)} 段` : '上传教材'} · 引用 {row.cites}
            </span>
          </div>
          {index === 0 && row.traced && <Tape className="mt-2" total={row.traced.paragraphs} reads={row.traced.reads} cites={row.traced.cites} label={row.title} />}
        </li>
      ))}
      {rows.length > limit && <li className="pt-1 text-sm text-muted">另有 {rows.length - limit} 份资料</li>}
    </ul>
  );
}

function SourcesTab({ course, summary, pending }: { course: CourseListItem; summary: TraceSummary; pending: boolean }) {
  const rows = useSourceRows(course, summary);
  return (
    <Panel title="资料来源" description="这门课允许 Agent 读取的全部资料。引用次数来自课程方案、课件与题组的生成记录。">
      {pending && <BlockLoading className="mt-3" lines={2} label="正在读取生成记录" />}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-base">
          <thead>
            <tr className="text-left text-sm text-muted">
              <th scope="col" className="w-1/2 pb-2 font-normal">资料</th>
              <th scope="col" className="pb-2 font-normal">类型</th>
              <th scope="col" className="pb-2 text-right font-normal">段数</th>
              <th scope="col" className="pb-2 text-right font-normal">被引用</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-t border-rule">
                <td className="max-w-0 py-3 pr-4">
                  <Link href={`/library/${encodeURIComponent(row.id)}`} className="block truncate font-medium hover:text-zhu">{row.title}</Link>
                </td>
                <td className="py-3 text-muted">{row.web ? '联网补充' : '上传教材'}</td>
                <td className="py-3 text-right tabular-nums">{row.traced ? formatCount(row.traced.paragraphs) : '—'}</td>
                <td className="py-3 text-right tabular-nums">{row.cites} 处</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
