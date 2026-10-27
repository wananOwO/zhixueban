'use client';

import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, newKey } from '@/lib/api/client';
import { useMode } from '@/lib/api/queries';
import { ACCEPTED_FORMATS } from '@/lib/labels';
import { cn, formatBytes } from '@/lib/utils';
import type { BookView } from '@/lib/api/types';
import { BlockError } from '@/components/states/block-states';
import { Panel } from '@/components/ui/panel';

/** 上传区：点击或拖放文件；同一文件重试复用同一幂等键，服务端不会重复导入 */
export function UploadZone({ onUploaded }: { onUploaded: (book: BookView) => void }) {
  const mode = useMode();
  const limit = mode.data?.uploadLimitBytes ?? 50 * 1024 * 1024;
  const input = useRef<HTMLInputElement>(null);
  const key = useRef<{ name: string; size: number; key: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function upload(file: File) {
    setError(null);
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!ACCEPTED_FORMATS.includes(ext)) { setError(new Error(`不支持 ${ext} 格式。支持：${ACCEPTED_FORMATS.join('、')}`)); return; }
    if (file.size > limit) { setError(new Error(`「${file.name}」有 ${formatBytes(file.size)}，超过 ${formatBytes(limit)} 的上限。`)); return; }
    if (file.size === 0) { setError(new Error(`「${file.name}」是空文件。`)); return; }
    if (!key.current || key.current.name !== file.name || key.current.size !== file.size) key.current = { name: file.name, size: file.size, key: newKey() };
    setUploading(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      const book = await api<BookView>('/textbooks', { method: 'POST', body: form, key: key.current.key });
      key.current = null;
      toast(`已导入《${book.title}》：${book.chapters.length} 章`);
      onUploaded(book);
    } catch (e) {
      setError(e);
    } finally {
      setUploading(null);
    }
  }

  return (
    <Panel title="上传教材" description={`支持 ${ACCEPTED_FORMATS.map(f => f.slice(1).toUpperCase()).join('、')}，单本不超过 ${formatBytes(limit)}${mode.data?.booksPerSpace ? `，最多 ${mode.data.booksPerSpace} 本` : ''}。`}>
      <button
        type="button"
        disabled={!!uploading}
        onClick={() => input.current?.click()}
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        aria-describedby="upload-help"
        className={cn(
          'mt-4 grid w-full place-items-center gap-2 rounded-[var(--radius-paper)] border border-dashed border-control px-4 py-10 text-center transition-colors',
          dragging ? 'border-zhu bg-zhu-tint' : 'hover:border-control-strong hover:bg-ground',
          uploading && 'cursor-progress',
        )}
      >
        {uploading ? <Loader2 className="size-6 animate-spin text-zhu" aria-hidden /> : <FileUp className="size-6 text-muted" aria-hidden />}
        <span className="font-medium">{uploading ? `正在解析「${uploading}」` : '选择文件，或把文件拖到这里'}</span>
        <span id="upload-help" className="text-sm text-muted">{uploading ? '大部头需要几十秒，请不要关闭页面。' : '解析在本机完成，按章节和段落编号。'}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_FORMATS.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      <div aria-live="polite"><BlockError className="mt-4" error={error} /></div>
      <p className="mt-5 text-sm text-ink-soft">请只上传你有权使用的资料。线上演示站建议使用公开教程（如 Python 官方文档）。</p>
    </Panel>
  );
}
