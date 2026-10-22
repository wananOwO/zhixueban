'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type CourseListItem, type FormDraft, type JobView } from '@/lib/verified-learning/client';
import ErrorBox from '@/components/verified-learning/error-box';
import JobStatus from '@/components/verified-learning/job-status';

export default function HomePage() {
  const [data, setData] = useState<{ courses: CourseListItem[]; drafts: FormDraft[]; jobs: JobView[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      const [courses, drafts, jobs] = await Promise.all([api<CourseListItem[]>('/courses'), api<FormDraft[]>('/drafts'), api<JobView[]>('/jobs')]);
      setData({ courses, drafts: drafts.filter(d => d.state !== 'confirmed'), jobs }); setError(null);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <main className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-bold">开始今天的学习</h1><p className="mt-2 text-muted-foreground">从教材出发，创建课程，继续上次的进度。</p></div>
        <Link href="/verified-learning/drafts" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">创建课程</Link>
      </div>
      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <p role="status">正在读取学习进度…</p>}
      {data && <>
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-border p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">继续学习</h2><Link href="/verified-learning/courses" className="text-sm text-accent">全部课程</Link></div>
            {data.courses.length ? <ul className="space-y-3">{data.courses.slice(0,3).map(c => <li key={c.versionId}><Link className="block rounded-md bg-muted p-3 text-sm hover:text-accent" href={c.sessionId ? `/verified-learning/learn/${c.sessionId}` : `/verified-learning/courses/${c.courseId}?versionId=${c.versionId}`}>{c.snapshot.goal || '未命名课程'}</Link></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有课程。先到<Link href="/verified-learning/textbooks" className="text-accent underline">教材库上传教材</Link>，再创建课程。</p>}
          </section>
          <section className="rounded-xl border border-border p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">未完成的草稿</h2><Link href="/verified-learning/drafts" className="text-sm text-accent">全部草稿</Link></div>
            {data.drafts.length ? <ul className="space-y-3">{data.drafts.slice(0,3).map(d => <li key={d.draftId}><Link href={`/verified-learning/drafts/${d.draftId}`} className="block rounded-md bg-muted p-3 text-sm hover:text-accent">{d.input.title || d.input.goal || '未命名草稿'}</Link></li>)}</ul> : <p className="text-sm text-muted-foreground">暂无草稿，创建课程时会自动保存填写内容。</p>}
          </section>
        </div>
        {data.jobs.length > 0 && <section><h2 className="mb-3 text-lg font-semibold">最近任务</h2><ul className="space-y-2">{data.jobs.slice(0,5).map(j => <JobStatus key={j.jobId} jobId={j.jobId} />)}</ul></section>}
      </>}
    </main>
  );
}
