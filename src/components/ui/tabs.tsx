'use client';

import { Tabs as T } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

/** 标签页：文字标签，当前项墨色下划线；窄屏横向滚动 */
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('flex gap-7 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)]', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'whitespace-nowrap py-2.5 text-base font-medium text-muted transition-colors hover:text-ink',
        'data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_-2px_0_var(--color-ink)]',
        className,
      )}
      {...props}
    />
  );
}
