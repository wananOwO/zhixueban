import { useId } from 'react';
import { cn } from '@/lib/utils';

/** 纸面面板：白纸、4px 圆角；标题为宋体 h2，右侧可放操作 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  tone = 'paper',
  headingLevel = 2,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  tone?: 'paper' | 'zhu';
  headingLevel?: 2 | 3;
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={cn('min-w-0 rounded-[var(--radius-paper)] px-7 py-6 max-md:px-4 max-md:py-5', tone === 'zhu' ? 'bg-zhu-tint' : 'bg-paper', className)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {title && <Heading id={id} className="font-serif text-h3 font-bold">{title}</Heading>}
          {actions && <div className="flex flex-wrap items-center gap-3 text-base">{actions}</div>}
        </div>
      )}
      {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
      {children}
    </section>
  );
}

const PILL_TONE = {
  neutral: 'bg-raised text-ink-soft',
  zhu: 'bg-zhu-tint text-zhu-deep',
  ink: 'bg-ink text-white',
  outline: 'border border-control text-ink-soft',
} as const;

/** 状态标签：小号、浅底深字，不挤压 */
export function Pill({ tone = 'neutral', children, className }: { tone?: keyof typeof PILL_TONE; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[4px] px-1.5 text-xs font-medium', PILL_TONE[tone], className)}>
      {children}
    </span>
  );
}

/** 文字链接：墨色、下划线在悬停时加深 */
export function TextLink({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn('font-medium text-ink underline decoration-control-strong underline-offset-4 transition-colors hover:decoration-ink', className)}
      {...props}
    />
  );
}
