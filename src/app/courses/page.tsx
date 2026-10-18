import Link from 'next/link';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function CoursesPage() {
  const db = getDb();
  const courses = db
    .prepare(
      `SELECT c.id, c.goal, c.mode, c.created_at AS createdAt, t.title AS textbookTitle
       FROM courses c JOIN textbooks t ON t.id = c.textbook_id
       ORDER BY c.created_at DESC`,
    )
    .all() as { id: string; goal: string; mode: number; createdAt: string; textbookTitle: string }[];

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的课程</h1>
        <Link
          href="/courses/new"
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background"
        >
          新建课程
        </Link>
      </div>
      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有课程。导入教材后来这里创建。</p>
      ) : (
        <ul className="grid gap-3">
          {courses.map((c) => (
            <li key={c.id}>
              <Link
                href={`/learn/${c.id}`}
                className="block rounded-md border border-border px-4 py-3 transition-colors hover:bg-muted"
              >
                <p className="text-sm font-medium">{c.goal}</p>
                <p className="text-xs text-muted-foreground">
                  《{c.textbookTitle}》 · 模式 {c.mode} · {new Date(c.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
