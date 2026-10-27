'use client';

import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** 居中对话框：唯一带阴影的浮层之一 */
export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-ink/30 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--radius-paper)] bg-paper p-6 shadow-[var(--shadow-float)] focus:outline-none',
          className,
        )}
      >
        <div className="grid gap-1 pr-8">
          <D.Title className="font-serif text-h3 font-bold">{title}</D.Title>
          {description && <D.Description className="text-base text-muted">{description}</D.Description>}
        </div>
        {children}
        <D.Close
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised hover:text-ink"
          aria-label="关闭"
        >
          <X className="size-4" aria-hidden />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

/** 右侧抽屉：用于原文回查、助教等 */
export function SheetContent({
  title,
  description,
  children,
  className,
  side = 'right',
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: 'right' | 'full';
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-ink/25" />
      <D.Content
        className={cn(
          'fixed z-50 flex flex-col bg-paper shadow-[var(--shadow-float)] focus:outline-none',
          side === 'right' ? 'inset-y-0 right-0 w-[min(34rem,100vw)]' : 'inset-0',
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <D.Title className="font-serif text-h3 font-bold">{title}</D.Title>
            {description && <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>}
          </div>
          <D.Close className="grid size-8 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised hover:text-ink" aria-label="关闭">
            <X className="size-4" aria-hidden />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
