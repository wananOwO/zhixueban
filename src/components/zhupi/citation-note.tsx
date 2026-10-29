import { cn } from '@/lib/utils';

/** 朱批旁注：来源与段号 + 宋体引文；整条可点击打开原文 */
export function CitationNote({
  sourceLabel,
  paragraphIndex,
  quote,
  onOpen,
  className,
}: {
  sourceLabel: string;
  paragraphIndex: number;
  quote: string;
  onOpen?: () => void;
  className?: string;
}) {
  const head = `${sourceLabel} · 第 ${paragraphIndex} 段`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('group block w-full rounded-[var(--radius-control)] text-left text-[0.78125rem] leading-[1.65] transition-colors hover:bg-zhu-tint/60 focus-visible:bg-zhu-tint/60', className)}
    >
      <span className="font-medium text-zhu group-hover:underline group-hover:underline-offset-4">{head}</span>
      <q className="mt-1 block font-serif text-muted [overflow-wrap:anywhere] [quotes:'「'_'」']">{quote}</q>
    </button>
  );
}
