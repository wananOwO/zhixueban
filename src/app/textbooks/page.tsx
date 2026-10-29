'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, FileUp, Loader2 } from 'lucide-react';
import SetupNotice from '@/components/setup-notice';

const ACCEPT = '.txt,.md,.markdown,.epub,.pdf,.docx,.mobi,.azw3';

export default function TextbooksPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function upload(file: File) {
    if (!ready || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/textbooks', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? '上传失败');
        return;
      }
      router.push(`/courses/new?textbookId=${body.textbookId}`);
    } catch {
      setError('网络错误，请重试');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold">
        <BookOpen aria-hidden className="h-6 w-6" />
        导入教材
      </h1>
      <p className="mb-8 text-muted-foreground">
        支持 TXT / Markdown / EPUB / PDF / DOCX / MOBI / AZW3
      </p>
      <SetupNotice onReady={setReady} />

      <button
        type="button"
        disabled={uploading || !ready}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        aria-label="选择或拖入教材文件"
        aria-busy={uploading}
        className={`flex h-56 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-colors ${
          dragging ? 'border-accent bg-muted' : 'border-border enabled:hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
        }`}
      >
        {uploading ? (
          <>
            <Loader2 aria-hidden className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground" role="status">
              正在解析教材并建立索引，请稍候…
            </span>
          </>
        ) : (
          <>
            <FileUp aria-hidden className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              点击选择文件，或将教材拖到这里
            </span>
          </>
        )}
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
        }}
      />

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
    </main>
  );
}
