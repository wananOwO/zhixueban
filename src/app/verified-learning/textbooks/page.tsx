'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, BookOpen, FileUp, Loader2, Search } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import {
  api,
  newKey,
  type BookView,
} from '@/lib/verified-learning/client';

const ACCEPT = '.txt,.md,.markdown,.epub,.pdf,.docx,.mobi,.azw3';

export default function TextbooksPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<BookView[] | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 同一文件重试时保留同一幂等键
  const uploadKey = useRef<{ name: string; key: string } | null>(null);

  const load = useCallback(async (q = query, archived = showArchived) => {
    try {
      const params = new URLSearchParams({ q, archived: String(archived) });
      setBooks(await api<BookView[]>(`/textbooks?${params}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [query, showArchived]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(file: File) {
    setError(null);
    setUploading(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      if (!uploadKey.current || uploadKey.current.name !== file.name) {
        uploadKey.current = { name: file.name, key: newKey() };
      }
      await api<BookView>('/textbooks', 'POST', form, uploadKey.current.key);
      uploadKey.current = null;
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setUploading(null);
    }
  }

  async function toggleArchive(book: BookView) {
    setBusy(book.bookId);
    setError(null);
    try {
      await api(`/textbooks/${book.bookId}`, 'PATCH', {
        expectedRevision: book.revision,
        archived: !book.archived,
      });
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }


  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen aria-hidden className="h-6 w-6" />
            教材库
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            支持 TXT / Markdown / EPUB / PDF / DOCX / MOBI / AZW3；上传同步解析，请稍候。
          </p>
        </div>
        <button
          type="button"
          disabled={!!uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <FileUp aria-hidden className="h-4 w-4" />
          )}
          {uploading ? `正在解析 ${uploading}…` : '上传教材'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>

      <form
        role="search"
        className="mb-6 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md border border-border px-3 py-2">
          <Search aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">搜索教材标题</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索教材标题…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          搜索
        </button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
              void load(query, e.target.checked);
            }}
          />
          显示已归档
        </label>
      </form>

      <ErrorBox error={error} onRetry={() => void load()} />

      {books === null ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在加载教材列表…
        </p>
      ) : books.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {query ? '没有匹配的教材。' : '还没有教材，先上传一本。'}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {books.map((book) => (
            <li
              key={book.bookId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/verified-learning/textbooks/${book.bookId}`}
                  className="font-medium hover:text-accent"
                >
                  {book.title}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {book.format.toUpperCase()} · {book.chapters.length} 章
                  {book.archived && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5">已归档</span>
                  )}
                  {book.status !== 'ready' && (
                    <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                      {book.status}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === book.bookId}
                onClick={() => void toggleArchive(book)}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                {book.archived ? (
                  <>
                    <ArchiveRestore aria-hidden className="h-3.5 w-3.5" />
                    恢复
                  </>
                ) : (
                  <>
                    <Archive aria-hidden className="h-3.5 w-3.5" />
                    归档
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}


    </>
  );
}
