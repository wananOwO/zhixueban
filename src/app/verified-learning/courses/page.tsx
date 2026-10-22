'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2, Play } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import { api, type CourseListItem } from '@/lib/verified-learning/client';

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setCourses(await api<CourseListItem[]>('/courses'));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <GraduationCap aria-hidden className="h-6 w-6" />
        我的课程
      </h1>

      <ErrorBox error={error} onRetry={load} />

      {courses === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在加载课程…
        </p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          还没有正式课程。先在<Link href="/verified-learning/drafts" className="text-accent underline">课程草稿</Link>里生成并确认一门。
        </p>
      ) : (
        <ul className="space-y-3">
          {courses.map((course) => {
            const pointCount =
              course.snapshot.outline?.reduce((sum, m) => sum + m.points.length, 0) ?? 0;
            return (
              <li
                key={course.versionId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/verified-learning/courses/${course.courseId}?versionId=${course.versionId}`}
                    className="font-medium hover:text-accent"
                  >
                    {course.snapshot.goal || '未命名课程'}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pointCount} 个知识点
                    {course.status === 'archived' && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5">已归档</span>
                    )}
                  </p>
                </div>
                {course.sessionId && (
                  <Link
                    href={`/verified-learning/learn/${course.sessionId}`}
                    className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                  >
                    <Play aria-hidden className="h-3.5 w-3.5" />
                    继续学习
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
