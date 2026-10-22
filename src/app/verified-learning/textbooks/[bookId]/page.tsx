'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import {
  api,
  type BookView,
  type ChapterPage,
  type DeletionImpact,
} from '@/lib/verified-learning/client';

export default function TextbookDetailPage() {
  const params = useParams<{ bookId: string }>();
  const router = useRouter();
  const bookId = params.bookId;

  const [book, setBook] = useState<BookView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [chapterPages, setChapterPages] = useState<Record<string, ChapterPage>>({});
  const [chapterLoading, setChapterLoading] = useState<string | null>(null);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBook(await api<BookView>(`/textbooks/${bookId}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleChapter(chapterId: string) {
    if (openChapter === chapterId) {
      setOpenChapter(null);
      return;
    }
    setOpenChapter(chapterId);
    if (!chapterPages[chapterId] && book) {
      setChapterLoading(chapterId);
      try {
        const page = await api<ChapterPage>(
          `/textbooks/${bookId}/chapters/${chapterId}?revision=${book.sourceRevision}&offset=0`,
        );
        setChapterPages((prev) => ({ ...prev, [chapterId]: page }));
      } catch (e) {
        setError(e);
      } finally {
        setChapterLoading(null);
      }
    }
  }

  async function loadMore(chapterId: string) {
    const page = chapterPages[chapterId];
    if (!page || page.nextOffset === null || !book) return;
    setChapterLoading(chapterId);
    try {
      const next = await api<ChapterPage>(
        `/textbooks/${bookId}/chapters/${chapterId}?revision=${book.sourceRevision}&offset=${page.nextOffset}`,
      );
      setChapterPages((prev) => ({
        ...prev,
        [chapterId]: {
          ...next,
          paragraphs: [...page.paragraphs, ...next.paragraphs],
        },
      }));
    } catch (e) {
      setError(e);
    } finally {
      setChapterLoading(null);
    }
  }

  async function toggleArchive() {
    if (!book) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/textbooks/${bookId}`, 'PATCH', {
        expectedRevision: book.revision,
        archived: !book.archived,
      });
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function inspectDeletion() {
    setError(null);
    try {
      setImpact(await api<DeletionImpact>(`/textbooks/${bookId}/deletion`));
      setConfirmName('');
    } catch (e) {
      setError(e);
    }
  }

  async function confirmDelete() {
    if (!book || !impact) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/textbooks/${bookId}/deletion`, 'DELETE', {
        expectedRevision: impact.revision,
        confirmName,
      });
      router.replace('/verified-learning/textbooks');
    } catch (e) {
      setError(e);
      setDeleting(false);
      // 删除期间新增关联会导致失败，重新拉取影响
      void inspectDeletion();
    }
  }

  return (
    <>
      {error && !book ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !book ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在加载教材…
        </p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <BookOpen aria-hidden className="h-6 w-6" />
                {book.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {book.format.toUpperCase()} · {book.chapters.length} 章
                {book.archived && <span className="ml-2 rounded bg-muted px-1.5 py-0.5">已归档</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleArchive()}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                {book.archived ? (
                  <>
                    <ArchiveRestore aria-hidden className="h-4 w-4" />
                    恢复教材
                  </>
                ) : (
                  <>
                    <Archive aria-hidden className="h-4 w-4" />
                    归档（可恢复）
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void inspectDeletion()}
                className="flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger/5"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                彻底删除
              </button>
            </div>
          </div>

          <ErrorBox error={error} />

          {impact && (
            <section
              aria-labelledby="deletion-impact"
              className="mb-6 rounded-lg border border-danger/40 bg-danger/5 p-4"
            >
              <h2 id="deletion-impact" className="mb-2 flex items-center gap-2 font-semibold text-danger">
                <TriangleAlert aria-hidden className="h-4 w-4" />
                删除影响
              </h2>
              {impact.blocked ? (
                <>
                  <p className="text-sm">
                    无法删除：以下内容仍在引用这本教材。请先处理关联，或改用归档。
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {impact.blockers.map((blocker) => (
                      <li key={`${blocker.kind}:${blocker.id}`}>
                        {blocker.kind === 'course' ? '课程版本' : blocker.kind === 'draft' ? '课程草稿' : blocker.kind}
                        ：{blocker.id}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setImpact(null)}
                    className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    知道了
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    删除后不可恢复（已学课程、成绩和笔记保留，外部原文件不受影响）。输入教材全名
                    <strong className="mx-1">{book.title}</strong>确认删除：
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={book.title}
                      aria-label="输入教材全名以确认删除"
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={deleting || confirmName !== book.title}
                      onClick={() => void confirmDelete()}
                      className="rounded-md bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {deleting ? '删除中…' : '确认删除'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImpact(null)}
                      className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                    >
                      取消
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          <section aria-labelledby="chapters-heading">
            <h2 id="chapters-heading" className="mb-3 text-lg font-semibold">
              目录与原文
            </h2>
            <ul className="space-y-2">
              {book.chapters.map((chapter) => {
                const open = openChapter === chapter.id;
                const page = chapterPages[chapter.id];
                return (
                  <li key={chapter.id} className="rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => void toggleChapter(chapter.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted"
                    >
                      {open ? (
                        <ChevronDown aria-hidden className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
                      )}
                      <span className="flex-1 font-medium">{chapter.title}</span>
                      <span className="text-xs text-muted-foreground">
                        约 {chapter.characterCount} 字
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-border px-4 py-3">
                        {chapterLoading === chapter.id && !page ? (
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                            正在加载原文…
                          </p>
                        ) : page ? (
                          <>
                            <ol className="space-y-2 text-sm leading-relaxed">
                              {page.paragraphs.map((p) => (
                                <li key={p.paragraphIndex} className="flex gap-3">
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {p.paragraphIndex + 1}
                                  </span>
                                  <p>{p.text}</p>
                                </li>
                              ))}
                            </ol>
                            {page.nextOffset !== null && (
                              <button
                                type="button"
                                disabled={chapterLoading === chapter.id}
                                onClick={() => void loadMore(chapter.id)}
                                className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                              >
                                {chapterLoading === chapter.id ? '加载中…' : '加载更多'}
                              </button>
                            )}
                          </>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
