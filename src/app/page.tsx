import Link from 'next/link';

export default function HomePage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="mb-4 text-sm font-medium tracking-widest text-muted-foreground uppercase">
        智学伴
      </p>
      <h1 className="mb-6 text-5xl font-bold tracking-tight">
        一本书，一门为你定制的课
      </h1>
      <p className="mb-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
        导入教材，告诉 AI 你想学什么、想怎么学。
        它为你裁剪课程、逐节讲解、出题考验，直到你真的学会。
      </p>
      <div className="flex gap-4">
        <Link
          href="/textbooks"
          className="rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          导入第一本教材
        </Link>
        <Link
          href="/courses"
          className="rounded-md border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
        >
          我的课程
        </Link>
      </div>
    </main>
  );
}
