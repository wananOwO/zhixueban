import { countParagraphs, mergeRanges } from '@/lib/tape';
import { cn, formatCount } from '@/lib/utils';

/**
 * 书带：一整本资料（例如 4,049 段）画成一条横带。
 * 灰色 = Agent 读过的段落区间；朱批细线 = 课件引用的段落。
 */
export function Tape({
  total,
  reads,
  cites,
  label,
  className,
  height = '1.5rem',
}: {
  total: number;
  reads: [number, number][];
  cites: number[];
  label: string;
  className?: string;
  height?: string;
}) {
  const merged = mergeRanges(reads);
  const uniqueCites = [...new Set(cites)];
  const safeTotal = Math.max(1, total);
  const percent = (n: number) => `${Math.min(100, Math.max(0, (n / safeTotal) * 100))}%`;
  return (
    <div className={className}>
      <div
        role="img"
        aria-label={`${label}：共 ${formatCount(total)} 段，Agent 读过 ${formatCount(countParagraphs(reads))} 段，课件引用 ${uniqueCites.length} 处`}
        className="relative overflow-hidden rounded-[3px] bg-raised"
        style={{ height }}
      >
        {merged.map(([from, to]) => (
          <span
            key={`r${from}`}
            className="absolute inset-y-0 bg-[#d3d2cd]"
            style={{ left: percent(from), width: `max(2px, ${percent(to - from + 1)})` }}
          />
        ))}
        {uniqueCites.map(index => (
          <span key={`c${index}`} className="absolute inset-y-0 w-[2px] bg-zhu" style={{ left: percent(index) }} />
        ))}
      </div>
      <div className={cn('mt-0.5 flex justify-between text-[0.6875rem] text-muted')} aria-hidden>
        <span>第 1 段</span>
        <span>第 {formatCount(total)} 段</span>
      </div>
    </div>
  );
}
