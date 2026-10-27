'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { errorHint } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** 加载中：与最终布局等大的灰条，不跳动、不闪光 */
export function BlockLoading({ lines = 3, label = '正在加载', className }: { lines?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('grid gap-2.5', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded-sm bg-raised" style={{ width: `${[92, 78, 64, 85, 70][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** 空状态：保留框架，一句话 + 下一步 */
export function BlockEmpty({ title, children, action, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid justify-items-start gap-2 py-2', className)}>
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="text-base text-muted">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** 错误：在出错的区块内说明，并给重试 */
export function BlockError({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const hint = errorHint(error);
  return (
    <div role="alert" className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-[var(--radius-control)] bg-zhu-tint px-4 py-3 text-base', className)}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-zhu" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-ink">{message}</p>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          重试
        </Button>
      )}
    </div>
  );
}
