'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { VisionMode } from '@/lib/verified-learning/vision/extraction';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * 截图预览子组件（VisionPreview）：支持鼠标与键盘 Delete/Backspace 移除并释放 Object URL。
 */
export function VisionPreview({
  previewUrl,
  fileName,
  fileSize,
  disabled,
  onRemove,
  onReselect,
}: {
  previewUrl: string;
  fileName: string;
  fileSize: number;
  disabled: boolean;
  onRemove: () => void;
  onReselect: () => void;
}) {
  const kb = Math.max(1, Math.round(fileSize / 1024));
  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-rule bg-ground p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{fileName}（{kb} KB）</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onReselect}>重新选择</Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="移除截图"
            disabled={disabled}
            onClick={onRemove}
            onKeyDown={event => {
              if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                onRemove();
              }
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />移除
          </Button>
        </div>
      </div>
      {/* biome-ignore lint/performance/noImgElement: 本地 blob Object URL 仅在浏览器内存预览，不能走远程图片优化 */}
      <img src={previewUrl} alt="待识别的题目或代码截图预览" className="max-h-40 w-auto rounded border border-rule object-contain" />
    </div>
  );
}

/**
 * 题目截图 / 代码截图输入组件（ScreenshotTutorInput）：
 * - 支持选择、粘贴、拖拽 PNG/JPEG/WebP（<= 5 MiB）；
 * - 原图仅在浏览器预览期间持有 Object URL，删除或卸载时立即 revoke；
 * - 提交前显式提示“截图将发送给所选视觉服务”，失败时焦点移至错误提示并支持改用文字提问。
 */
export function ScreenshotTutorInput({
  disabled,
  extracting,
  error,
  onExtract,
  onSwitchToText,
}: {
  disabled: boolean;
  extracting: boolean;
  error: string | null;
  onExtract: (file: File, mode: VisionMode) => void;
  onSwitchToText?: () => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<VisionMode>('explain');
  const [localError, setLocalError] = useState<string | null>(null);
  const [attemptedOnce, setAttemptedOnce] = useState(false);

  const revokeCurrent = (url: string | null) => {
    if (url) URL.revokeObjectURL(url);
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const activeError = localError ?? error;
  useEffect(() => {
    if (activeError) alertRef.current?.focus();
  }, [activeError]);

  function acceptFile(file: File | undefined | null) {
    if (!file) return;
    setLocalError(null);
    setAttemptedOnce(false);
    const ext = file.name.toLowerCase();
    if (file.type === 'image/svg+xml' || ext.endsWith('.svg')) {
      setLocalError('不支持 SVG 格式，请使用 PNG、JPEG 或 WebP 截图。');
      return;
    }
    if (!ALLOWED_TYPES.has(file.type) && !/\.(png|jpe?g|webp)$/i.test(ext)) {
      setLocalError('仅支持 PNG、JPEG、WebP 格式的题目或代码截图。');
      return;
    }
    if (file.size === 0) {
      setLocalError('图片文件为空，请重新截图。');
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError('截图超过 5 MiB 上限，请裁剪题目或代码区域后再试。');
      return;
    }
    revokeCurrent(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearFile() {
    revokeCurrent(previewUrl);
    setPreviewUrl(null);
    setSelectedFile(null);
    setLocalError(null);
    setAttemptedOnce(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => {
      if (disabled || extracting) return;
      const item = [...(event.clipboardData?.items ?? [])].find(entry => entry.kind === 'file');
      if (item) {
        event.preventDefault();
        acceptFile(item.getAsFile());
      }
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  });

  return (
    <div className="grid gap-3 rounded-[var(--radius-control)] border border-rule bg-paper p-3">
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择或粘贴题目与代码截图"
        disabled={disabled || extracting}
        className="sr-only"
        onChange={event => acceptFile(event.target.files?.[0])}
      />

      {!selectedFile || !previewUrl ? (
        <button
          type="button"
          disabled={disabled || extracting}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={event => { if (!disabled && !extracting) event.preventDefault(); }}
          onDrop={event => {
            if (disabled || extracting) return;
            event.preventDefault();
            acceptFile(event.dataTransfer?.files?.[0]);
          }}
          className="grid w-full gap-1.5 rounded-[var(--radius-control)] border border-dashed border-rule bg-ground px-3 py-4 text-center transition-colors hover:border-ink disabled:opacity-50"
        >
          <span className="flex items-center justify-center gap-1.5 text-sm font-medium text-ink">
            <ImagePlus className="size-4" aria-hidden />选择截图（支持拖拽或 Ctrl+V 粘贴）
          </span>
          <span className="text-xs text-muted">支持 PNG / JPEG / WebP，单张不超过 5 MiB，最长边不超过 4096 像素</span>
        </button>
      ) : (
        <>
          <VisionPreview
            previewUrl={previewUrl}
            fileName={selectedFile.name || '截图'}
            fileSize={selectedFile.size}
            disabled={extracting}
            onRemove={clearFile}
            onReselect={() => fileInputRef.current?.click()}
          />
          <fieldset className="grid grid-cols-3 gap-1.5 rounded-[var(--radius-control)] bg-raised p-1 text-xs" disabled={extracting}>
            <legend className="sr-only">选择截图用途</legend>
            {([
              ['explain', '解释题目'],
              ['analyze-code', '分析代码'],
              ['practice', '生成变式题'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`rounded py-1.5 font-medium transition-colors ${mode === value ? 'bg-paper text-ink' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <p className="text-xs text-muted">
            隐私与计费提示：点击识别后，截图将发送给所选视觉服务并消耗一次视觉模型调用；提交前请裁去姓名、学号等无关隐私内容。原图不会保存到服务器。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={disabled || extracting}
              onClick={() => {
                setAttemptedOnce(true);
                onExtract(selectedFile, mode);
              }}
            >
              {extracting ? <Loader2 className="animate-spin" aria-hidden /> : attemptedOnce && error ? <RefreshCw aria-hidden /> : null}
              {extracting ? '正在识别截图…' : attemptedOnce && error ? '手动重试识别（可能再次计费）' : '识别截图内容'}
            </Button>
            {onSwitchToText && (
              <Button type="button" size="sm" variant="ghost" disabled={extracting} onClick={onSwitchToText}>
                改用粘贴文字
              </Button>
            )}
          </div>
        </>
      )}

      {activeError && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="rounded-[var(--radius-control)] bg-zhu-tint px-3 py-2 text-xs text-zhu-deep outline-none focus:ring-2 focus:ring-ink"
        >
          <p>{activeError}</p>
          {onSwitchToText && (
            <button type="button" onClick={onSwitchToText} className="mt-1 font-medium underline underline-offset-4">
              切换到文字粘贴提问
            </button>
          )}
        </div>
      )}
    </div>
  );
}
