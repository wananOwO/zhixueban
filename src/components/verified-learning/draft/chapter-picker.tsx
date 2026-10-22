'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  api,
  type BookView,
  type DraftSource,
  type SourceSnapshotView,
} from '@/lib/verified-learning/client';

/**
 * 资料来源选择：最多 4 个来源，勾选章节。
 * 选择教材后拉取来源快照，保存 sourceId/sourceRevision/chapterIds。
 */
export default function ChapterPicker({
  books,
  sources,
  onChange,
  onError,
}: {
  books: BookView[];
  sources: DraftSource[];
  onChange: (sources: DraftSource[]) => void;
  onError: (error: unknown) => void;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, SourceSnapshotView>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [pick, setPick] = useState('');

  // 已选来源进入页面时补拉快照（用于展示章节勾选状态）
  useEffect(() => {
    for (const source of sources) {
      if (!snapshots[source.sourceId]) {
        setLoading(source.sourceId);
        api<SourceSnapshotView>(`/textbooks/${source.sourceId}/source?revision=${source.sourceRevision}`)
          .then((snapshot) => setSnapshots((prev) => ({ ...prev, [source.sourceId]: snapshot })))
          .catch(onError)
          .finally(() => setLoading(null));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  const available = books.filter(
    (book) => book.status === 'ready' && !book.archived && !sources.some((s) => s.sourceId === book.bookId),
  );

  async function addSource(bookId: string) {
    if (!bookId) return;
    setLoading(bookId);
    try {
      const snapshot = await api<SourceSnapshotView>(`/textbooks/${bookId}/source`);
      setSnapshots((prev) => ({ ...prev, [bookId]: snapshot }));
      onChange([
        ...sources,
        { sourceId: bookId, sourceRevision: snapshot.sourceRevision, chapterIds: [] },
      ]);
      setPick('');
    } catch (e) {
      setPick('');
      onError(e);
    } finally {
      setLoading(null);
    }
  }

  function toggleChapter(sourceId: string, chapterId: string) {
    onChange(
      sources.map((source) => {
        if (source.sourceId !== sourceId) return source;
        const has = source.chapterIds.includes(chapterId);
        return {
          ...source,
          chapterIds: has
            ? source.chapterIds.filter((id) => id !== chapterId)
            : [...source.chapterIds, chapterId],
        };
      }),
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">资料来源（最多 4 个）</legend>
      {sources.map((source) => {
        const snapshot = snapshots[source.sourceId];
        const book = books.find((b) => b.bookId === source.sourceId);
        return (
          <div key={source.sourceId} className="rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-medium">{snapshot?.title ?? book?.title ?? source.sourceId}</p>
              <button
                type="button"
                onClick={() => onChange(sources.filter((s) => s.sourceId !== source.sourceId))}
                aria-label="移除该来源"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            {loading === source.sourceId && !snapshot ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                正在加载章节…
              </p>
            ) : snapshot ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {snapshot.chapters.map((chapter) => (
                  <li key={chapter.chapterId}>
                    <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={source.chapterIds.includes(chapter.chapterId)}
                        onChange={() => toggleChapter(source.sourceId, chapter.chapterId)}
                      />
                      <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">章节快照不可用。</p>
            )}
            {snapshot && <button type="button" onClick={() => onChange(sources.map(s => s.sourceId === source.sourceId ? { ...s, chapterIds: snapshot.chapters.map(c => c.chapterId) } : s))} className="mt-2 text-sm text-accent underline">全选章节</button>}
            <p className="mt-1 text-xs text-muted-foreground">
              已选 {source.chapterIds.length} 章
            </p>
          </div>
        );
      })}
      {available.length > 0 && sources.length < 4 && (
        <div className="flex items-center gap-2">
          <select
            value={pick}
            disabled={loading !== null}
            onChange={(e) => { setPick(e.target.value); void addSource(e.target.value); }}
            aria-label="选择要添加的教材"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">选择教材…</option>
            {available.map((book) => (
              <option key={book.bookId} value={book.bookId}>
                {book.title}
              </option>
            ))}
          </select>
          {loading && <span role="status" className="text-sm text-muted-foreground">正在加入教材…</span>}
        </div>
      )}
    </fieldset>
  );
}
