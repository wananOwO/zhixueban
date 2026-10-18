'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MODE_NAMES: Record<number, string> = { 1: '理论学习', 2: '边学边练', 3: '刷题模式' };

interface Props {
  courseId: string;
  goal: string;
  mode: number;
  textbookTitle: string;
  outline: { kpId: string; title: string }[];
  children: React.ReactNode;
}

/** 学习工作台外壳：左侧大纲树 + 模式切换，右侧内容区 */
export default function LearnShell({ courseId, goal, mode, textbookTitle, outline, children }: Props) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  async function switchTo(newMode: number) {
    if (newMode === mode) return;
    setSwitching(true);
    await fetch('/api/courses/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId, mode: newMode }),
    });
    setSwitching(false);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-border p-4" aria-label="课程大纲">
        <p className="mb-1 text-xs text-muted-foreground">《{textbookTitle}》</p>
        <h1 className="mb-4 text-sm font-semibold">{goal}</h1>

        <div role="group" aria-label="切换学习模式" className="mb-6 flex rounded-md border border-border p-0.5 text-xs">
          {[1, 2, 3].map((m) => (
            <button
              key={m}
              type="button"
              disabled={switching}
              onClick={() => void switchTo(m)}
              aria-pressed={m === mode}
              className={`flex-1 rounded px-2 py-1.5 transition-colors ${
                m === mode ? 'bg-foreground text-background' : 'hover:bg-muted'
              }`}
            >
              {MODE_NAMES[m]}
            </button>
          ))}
        </div>

        <nav aria-label="知识点列表">
          <ol className="grid gap-1 text-sm">
            {outline.map((n, i) => (
              <li key={n.kpId} className="rounded px-2 py-1.5 text-muted-foreground">
                {i + 1}. {n.title}
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      <main id="main" className="flex-1 px-8 py-10">
        {children}
      </main>
    </div>
  );
}
