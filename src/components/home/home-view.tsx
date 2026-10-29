'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookOpen, FilePen, Upload } from 'lucide-react';
import { useDrafts, useCourses, useJobs, isRunning, useSession, useProgress, useCreateDraft, useBooks } from '@/lib/api/hooks';
import { courseTitle, describeNext, draftTitle, outlinePoints, toRoadmapPoints } from '@/lib/course';
import { DRAFT_STATE_LABEL, JOB_KIND_LABEL, JOB_STATUS_LABEL } from '@/lib/labels';
import { formatShortTime } from '@/lib/utils';
import type { CourseListItem, FormDraft } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';
import { Roadmap } from '@/components/zhupi/roadmap';
import { MasteryStrip } from '@/components/zhupi/mastery-strip';

export function HomeView() {
  const courses = useCourses();
  const drafts = useDrafts();
  const books = useBooks();
  const jobs = useJobs();
  const createDraft = useCreateDraft();
  const active = courses.data?.filter(c => c.status !== 'archived') ?? [];
  const openDrafts = drafts.data?.filter(d => d.state !== 'confirmed' && d.state !== 'discarded') ?? [];
  const running = jobs.data?.filter(isRunning) ?? [];
  const loading = courses.isPending || drafts.isPending || books.isPending;
  const firstRun = !loading && active.length === 0 && openDrafts.length === 0;

  return (
    <>
      <PageHeader
        title="今天从哪继续"
        description={firstRun ? '三步开始：上传教材，写下学习目标，让 Agent 读书编课。' : '最近在学的课程、没写完的草稿和正在生成的内容都在这里。'}
        actions={
          <>
            <Button asChild><Link href="/library"><Upload aria-hidden />上传教材</Link></Button>
            <Button variant="primary" disabled={createDraft.isPending} onClick={() => createDraft.mutate()}><FilePen aria-hidden />新建课程</Button>
          </>
        }
      />
      <BlockError className="mt-4" error={createDraft.error} />
      <BlockError className="mt-4" error={courses.error ?? drafts.error} onRetry={() => { void courses.refetch(); void drafts.refetch(); }} />

      {loading && <Panel className="mt-6"><BlockLoading lines={6} label="正在读取学习进度" /></Panel>}
      {firstRun && <FirstRun hasBooks={(books.data?.length ?? 0) > 0} onCreate={() => createDraft.mutate()} creating={createDraft.isPending} />}

      {!loading && !firstRun && (
        <div className={active.length > 0 ? 'mt-6 grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-6 max-2xl:grid-cols-1' : 'mt-6'}>
          {active.length > 0 && <CurrentCourse course={active[0]} drafts={drafts.data} />}
          <div className={active.length > 0 ? 'grid gap-6 max-2xl:grid-cols-3 max-xl:grid-cols-2 max-md:grid-cols-1' : 'grid grid-cols-3 gap-6 max-xl:grid-cols-2 max-md:grid-cols-1'}>
          <Panel title="我的课程" actions={<Link href="/courses" className="text-sm text-muted hover:text-ink">全部课程</Link>}>
            {active.length === 0 ? (
              <BlockEmpty className="mt-3" title="还没有正式课程">在草稿里生成方案并确认后，课程会出现在这里。</BlockEmpty>
            ) : (
              <ul className="mt-3">
                {active.slice(0, 4).map(course => (
                  <li key={course.versionId} className="border-t border-rule first:border-t-0">
                    <Link href={`/courses/${course.courseId}`} className="flex items-baseline justify-between gap-3 py-2.5 hover:text-zhu">
                      <span className="min-w-0 truncate font-medium">{courseTitle(course, drafts.data)}</span>
                      <span className="shrink-0 text-sm text-muted">{outlinePoints(course.snapshot.outline).length} 个知识点</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="没写完的草稿" actions={<Link href="/drafts" className="text-sm text-muted hover:text-ink">全部草稿</Link>}>
            {openDrafts.length === 0 ? (
              <BlockEmpty className="mt-3" title="没有未完成的草稿">新建课程时，填写内容会自动保存为草稿。</BlockEmpty>
            ) : (
              <ul className="mt-3">
                {openDrafts.slice(0, 4).map(draft => <DraftRow key={draft.draftId} draft={draft} />)}
              </ul>
            )}
          </Panel>
          <Panel title="正在生成" description={running.length ? 'Agent 在后台读教材、写内容并逐项验收。' : undefined}>
            {jobs.isPending ? <BlockLoading className="mt-3" lines={2} /> : running.length === 0 ? (
              <BlockEmpty className="mt-3" title="没有正在进行的任务">课程方案、课件和题组都在后台生成，关掉页面也会继续。</BlockEmpty>
            ) : (
              <ul className="mt-3">
                {running.slice(0, 4).map(job => (
                  <li key={job.jobId} className="flex items-baseline justify-between gap-3 border-t border-rule py-2.5 first:border-t-0">
                    <span className="min-w-0">
                      <span className="font-medium">{JOB_KIND_LABEL[job.kind] ?? job.kind}</span>
                      <span className="mt-0.5 block truncate text-sm text-muted">{job.stage}</span>
                    </span>
                    <Pill tone="zhu">{JOB_STATUS_LABEL[job.status]}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function DraftRow({ draft }: { draft: FormDraft }) {
  return (
    <li className="border-t border-rule first:border-t-0">
      <Link href={`/drafts/${draft.draftId}`} className="flex items-baseline justify-between gap-3 py-2.5 hover:text-zhu">
        <span className="min-w-0 truncate font-medium">{draftTitle(draft)}</span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
          {draft.updatedAt && formatShortTime(draft.updatedAt)}
          <Pill tone={draft.state === 'review' ? 'zhu' : 'neutral'}>{DRAFT_STATE_LABEL[draft.state] ?? draft.state}</Pill>
        </span>
      </Link>
    </li>
  );
}

/** 最近的课程：一句话下一步 + 掌握条 + 路线图（只读缩略，点击进课程） */
function CurrentCourse({ course, drafts }: { course: CourseListItem; drafts?: FormDraft[] }) {
  const router = useRouter();
  const session = useSession(course.sessionId);
  const progress = useProgress(course.versionId);
  const points = toRoadmapPoints(course.snapshot.outline);
  const verified = new Set(progress.data?.verifiedKnowledgePointIds ?? []);
  const recent = progress.data?.recent ?? {};
  const practiced = new Set(Object.entries(recent).filter(([, list]) => list.length > 0).map(([id]) => id));
  const next = session.data ? describeNext(session.data) : null;
  const current = next?.pointIds[0];
  const evidence = Object.fromEntries(Object.entries(recent).map(([id, list]) => [id, list.map(ok => (ok ? 'ok' : 'no') as 'ok' | 'no')]));
  const href = course.sessionId ? `/learn/${course.sessionId}` : `/courses/${course.courseId}`;
  return (
    <Panel
      title={courseTitle(course, drafts)}
      description={course.snapshot.goal ? `目标：${course.snapshot.goal}` : undefined}
      actions={
        <>
          <Link href={`/courses/${course.courseId}`} className="text-sm text-muted hover:text-ink">课程主页</Link>
          <Button asChild variant="primary" size="sm"><Link href={href}>继续学习<ArrowRight aria-hidden /></Link></Button>
        </>
      }
    >
      {next && (
        <p className="mt-4 text-base">
          <span className="font-medium text-zhu">{next.title}</span>
          <span className="ml-2 text-muted">{next.detail}</span>
        </p>
      )}
      <MasteryStrip className="mt-4" points={points} verified={verified} practiced={practiced} current={current} />
      {points.length > 0 && <Roadmap className="mt-6" points={points} evidence={evidence} current={current} onOpen={id => router.push(`/courses/${course.courseId}?point=${encodeURIComponent(id)}`)} />}
    </Panel>
  );
}

function FirstRun({ hasBooks, onCreate, creating }: { hasBooks: boolean; onCreate: () => void; creating: boolean }) {
  const steps = [
    { title: '上传教材', body: '支持 PDF、EPUB、DOCX、TXT、Markdown。上传后按章节和段落解析，之后每句讲解都能回查到原书第几段。', action: <Button asChild variant={hasBooks ? 'secondary' : 'primary'}><Link href="/library"><BookOpen aria-hidden />{hasBooks ? '查看教材库' : '去上传教材'}</Link></Button>, done: hasBooks },
    { title: '写下学习目标', body: '比如“能用 Python 解蓝桥杯入门题”。选好教材章节，Agent 会自动补齐需要的先修知识点。', action: <Button variant={hasBooks ? 'primary' : 'secondary'} disabled={creating} onClick={onCreate}><FilePen aria-hidden />新建课程</Button>, done: false },
    { title: '核对方案后开始学', body: '生成的方案是一张先修路线图。确认后按顺序学：读课件、做练习，掌握要用 3 道不同的题证明。', action: null, done: false },
  ];
  return (
    <ol aria-label="开始使用的三个步骤" className="mt-6 grid grid-cols-3 gap-6 max-lg:grid-cols-1">
      {steps.map((step, index) => (
        <li key={step.title} className="flex flex-col rounded-[var(--radius-paper)] bg-paper px-7 py-6">
          <span className="font-serif text-[2.5rem] font-bold leading-none text-zhu" aria-hidden>{index + 1}</span>
          <h2 className="mt-4 font-serif text-h3 font-bold">{step.title}{step.done && <span className="ml-2 align-middle text-sm font-normal text-muted">已完成</span>}</h2>
          <p className="mt-2 text-base text-ink-soft">{step.body}</p>
          {step.action && <div className="mt-auto pt-5">{step.action}</div>}
        </li>
      ))}
    </ol>
  );
}
