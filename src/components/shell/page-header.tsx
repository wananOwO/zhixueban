import Link from 'next/link';
import { cn } from '@/lib/utils';

/** 页面标题区：面包屑、宋体 h1、一句说明、右侧操作 */
export function PageHeader({
  crumbs,
  title,
  description,
  actions,
  className,
}: {
  crumbs?: { href?: string; label: string }[];
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-8 gap-y-4 pt-5 max-md:grid-cols-1', className)}>
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="面包屑" className="text-sm text-muted">
            {crumbs.map((crumb, index) => (
              <span key={index}>
                {index > 0 && <span aria-hidden> / </span>}
                {crumb.href ? <Link href={crumb.href} className="hover:text-ink">{crumb.label}</Link> : crumb.label}
              </span>
            ))}
          </nav>
        )}
        <h1 className="mt-1.5 font-serif text-h1 font-bold tracking-[-0.01em] max-md:text-[1.375rem]">{title}</h1>
        {description && <div className="mt-1 text-base text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
