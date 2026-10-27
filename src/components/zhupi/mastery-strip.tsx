import { cn } from '@/lib/utils';

/**
 * 掌握条：课程全部知识点按学习顺序排成一条，每格一个知识点。
 * 墨色 = 已验证掌握；朱批 = 正在学；浅朱 = 已有作答但未达标；灰 = 未开始。
 */
export function MasteryStrip({
  points,
  verified,
  practiced,
  current,
  className,
}: {
  points: { id: string; title: string }[];
  verified: Set<string>;
  practiced: Set<string>;
  current?: string;
  className?: string;
}) {
  const done = points.filter(p => verified.has(p.id)).length;
  const working = points.filter(p => !verified.has(p.id) && (practiced.has(p.id) || p.id === current)).length;
  return (
    <div className={className}>
      <div role="img" aria-label={`已验证掌握 ${done} / ${points.length} 个知识点，${working} 个在学`} className="flex gap-[3px]">
        {points.map(point => (
          <span
            key={point.id}
            title={point.title}
            className={cn(
              'h-2.5 min-w-1 flex-1 rounded-[2px]',
              verified.has(point.id) ? 'bg-ink' : point.id === current ? 'bg-zhu' : practiced.has(point.id) ? 'bg-[#e2bcc1]' : 'bg-raised',
            )}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-ink" />已验证掌握 {done}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-zhu" />正在学</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[#e2bcc1]" />已作答未达标</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-raised" />未开始</span>
      </div>
    </div>
  );
}
