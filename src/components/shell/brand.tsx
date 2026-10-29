import Link from 'next/link';
import { cn } from '@/lib/utils';

/** 标志：朱红方印「学」+ 宋体字标 */
export function Seal({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid size-[1.625rem] shrink-0 place-items-center rounded-[4px] bg-zhu font-serif text-[0.9375rem] font-bold leading-none text-white', className)}
    >
      学
    </span>
  );
}

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 font-serif text-[1.0625rem] font-bold leading-none">
      <Seal />
      智学伴
    </Link>
  );
}
