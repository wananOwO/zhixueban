'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useCourses, useDrafts, useHistory, useProgress, useSession } from '@/lib/api/hooks';
import { courseTitle, describeNext, outlinePoints } from '@/lib/course';
import { formatShortTime } from '@/lib/utils';
import type { CourseListItem, FormDraft } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';

/** 我的课程：每门课一行，目标、掌握进度（真实比例）、下一步、最近学习时间 */
export function CourseList() {
  const courses = useCourses();
  const drafts = useDrafts();
  const list = courses.data ?? [];
  const active = list.filter(c => c.status === 'active');
  const archived = list.filter(c => c.status !== 'active');

  return (
    <>
      <PageHeader title="我的课程" description="确认过的课程方案。掌握进度只计独立答对的不同题，读课件和自报基础不算。" />
      <BlockError className="mt-4" error={courses.error} onRetry={() => void courses.refetch()} />
      <Panel className="mt-6" title="在学的课程" description={active.length ? `${active.length} 门` : undefined}>
        {courses.isPending ? <BlockLoading className="mt-4" lines={4} label="正在读取课程" /> : active.length === 0 ? (
          <BlockEmpty
            className="mt-3"
            title="还没有正式课程"
            action={<Button asChild variant="primary"><Link href="/drafts">去课程草稿</Link></Button>}
          >
            在草稿里写好目标、生成方案并确认后，课程会出现在这里。
          </BlockEmpty>
        ) : (
          <ul className="mt-2">
            {active.map(course => <CourseRow key={course.versionId} course={course} drafts={drafts.data} />)}
          </ul>
        )}
      </Panel>
      {archived.length > 0 && (
        <Panel className="mt-6" title="旧版本" description="课程更新后，之前的版本保留在这里，可以回看。">
          <ul className="mt-2">
            {archived.map(course => <CourseRow key={course.versionId} course={course} drafts={drafts.data} />)}
          </ul>
        </Panel>
      )}
    </>
  );
}

function CourseRow({ course, drafts }: { course: CourseListItem; drafts?: FormDraft[] }) {
  const title = courseTitle(course, drafts);
  const total = outlinePoints(course.snapshot.outline).length;
  const progress = useProgress(course.versionId);
  const session = useSession(course.sessionId);
  const history = useHistory(course.sessionId);
  const verified = progress.data?.verifiedKnowledgePointIds.length ?? 0;
  const next = session.data ? describeNext(session.data) : null;
  const last = history.data?.[0]?.createdAt;
  const href = course.sessionId ? `/learn/${course.sessionId}` : `/courses/${course.courseId}`;

  return (
    <li className="grid grid-cols-[minmax(0,1.3fr)_minmax(12rem,1fr)_minmax(0,1.2fr)_auto] items-center gap-x-8 gap-y-3 border-t border-rule py-4 first:border-t-0 max-xl:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto] max-md:grid-cols-1">
      <div className="min-w-0">
        <Link href={`/courses/${course.courseId}`} className="font-serif text-h3 font-bold hover:text-zhu">{title}</Link>
        {course.status !== 'active' && <Pill className="ml-2 align-middle">旧版本</Pill>}
        {course.snapshot.goal && <p className="mt-0.5 line-clamp-2 text-sm text-muted">目标：{course.snapshot.goal}</p>}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted">已验证掌握</span>
          <span className="tabular-nums">{progress.isPending ? '—' : `${verified} / ${total}`}</span>
        </div>
        <div
          role="progressbar"
          aria-label={`${title}：已验证掌握 ${verified} / ${total} 个知识点`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={verified}
          className="mt-1.5 h-2 overflow-hidden rounded-[2px] bg-raised"
        >
          <div data-fill className="h-full bg-zhu" style={{ width: total ? `${(verified / total) * 100}%` : '0%' }} />
        </div>
      </div>
      <div className="min-w-0 text-base max-xl:col-span-2 max-xl:row-start-2 max-md:col-span-1 max-md:row-start-auto">
        {next ? <p className="truncate">{next.title}</p> : <p className="text-muted">{session.isPending && course.sessionId ? '正在读取下一步…' : '—'}</p>}
        <p className="mt-0.5 text-sm text-muted">{last ? `最近学习 ${formatShortTime(last)}` : '还没开始学'}</p>
      </div>
      <Button asChild variant={course.status === 'active' ? 'primary' : 'secondary'} size="sm" className="justify-self-end max-xl:row-span-2 max-xl:row-start-1 max-xl:col-start-3 max-md:col-start-1 max-md:row-span-1 max-md:row-start-auto max-md:justify-self-start">
        <Link href={href} aria-label={`${course.status === 'active' ? '继续学习' : '回看'} ${title}`}>
          {course.status === 'active' ? '继续学习' : '回看'}<ArrowRight aria-hidden />
        </Link>
      </Button>
    </li>
  );
}
