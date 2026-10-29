'use client';

import { useQueries } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { isWebSource } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { BookView, DraftSource, SourceSnapshotView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { BlockError, BlockLoading } from '@/components/states/block-states';

const MAX_SOURCES = 4;

/** 资料与章节：第一本为主教材；最多 4 本；章节显式勾选，可全选 */
export function SourcePicker({ books, sources, onChange }: { books: BookView[]; sources: DraftSource[]; onChange: (sources: DraftSource[]) => void }) {
  const snapshots = useQueries({
    queries: sources.map(source => ({
      queryKey: ['source', source.sourceId, source.sourceRevision],
      queryFn: () => api<SourceSnapshotView>(`/textbooks/${encodeURIComponent(source.sourceId)}/source?revision=${encodeURIComponent(source.sourceRevision)}`),
      staleTime: Infinity,
    })),
  });
  const available = books.filter(b => b.status === 'ready' && !b.archived && !isWebSource(b.bookId) && !sources.some(s => s.sourceId === b.bookId));

  async function add(book: BookView) {
    onChange([...sources, { sourceId: book.bookId, sourceRevision: book.sourceRevision, chapterIds: [] }]);
  }
  const update = (sourceId: string, chapterIds: string[]) => onChange(sources.map(s => (s.sourceId === sourceId ? { ...s, chapterIds } : s)));

  return (
    <div className="grid gap-4">
      {sources.map((source, index) => {
        const query = snapshots[index];
        const snapshot = query?.data;
        const book = books.find(b => b.bookId === source.sourceId);
        const title = snapshot?.title ?? book?.title ?? '教材';
        const all = snapshot?.chapters.map(c => c.chapterId) ?? [];
        const allSelected = all.length > 0 && all.every(id => source.chapterIds.includes(id));
        return (
          <fieldset key={source.sourceId} className="rounded-[var(--radius-paper)] border border-line px-5 py-4">
            <legend className="sr-only">{title}的章节</legend>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium">{title}</span>
              <span className="text-sm text-muted">{index === 0 ? '主教材' : '辅助资料'} · 已选 {source.chapterIds.length} / {all.length || '—'} 章</span>
              <div className="ml-auto flex gap-1">
                {snapshot && (
                  <Button size="sm" variant="ghost" onClick={() => update(source.sourceId, allSelected ? [] : all)}>
                    {allSelected ? '清空章节' : '全选章节'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label={`移除《${title}》`} onClick={() => onChange(sources.filter(s => s.sourceId !== source.sourceId))}>
                  <X aria-hidden />移除
                </Button>
              </div>
            </div>
            {query?.isPending && <BlockLoading className="mt-3" lines={2} label="正在读取章节" />}
            <BlockError className="mt-3" error={query?.error} onRetry={() => void query?.refetch()} />
            {snapshot && (
              <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 max-md:grid-cols-1">
                {snapshot.chapters.map(chapter => {
                  const checked = source.chapterIds.includes(chapter.chapterId);
                  return (
                    <li key={chapter.chapterId}>
                      <label className={cn('flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-base hover:bg-ground', checked && 'font-medium')}>
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-ink)]"
                          checked={checked}
                          onChange={() => update(source.sourceId, checked ? source.chapterIds.filter(id => id !== chapter.chapterId) : [...source.chapterIds, chapter.chapterId])}
                        />
                        <span className="min-w-0 truncate">{chapter.title}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        );
      })}
      {sources.length < MAX_SOURCES && available.length > 0 && (
        <div>
          <p className="text-sm text-muted">{sources.length === 0 ? '选择主教材：' : '再加一本辅助资料（可选）：'}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {available.map(book => (
              <li key={book.bookId}>
                <Button size="sm" onClick={() => void add(book)} aria-label={`加入《${book.title}》`}>
                  <Plus aria-hidden />{book.title.length > 28 ? `${book.title.slice(0, 28)}…` : book.title}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {books.filter(b => !isWebSource(b.bookId)).length === 0 && (
        <p className="text-base text-ink-soft">教材库还是空的，先 <a href="/library" className="font-medium underline underline-offset-4">上传一本教材</a>。</p>
      )}
    </div>
  );
}
