'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ancestors, layoutRoadmap, type RoadmapPoint } from '@/lib/roadmap';
import { PHONE_QUERY, useMediaQuery } from '@/lib/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { GradeMark } from './grade-mark';

export type Evidence = Record<string, ('ok' | 'no')[]>;
/** 审核页用：学习目标 / 自动先修 / 已掌握 / 排除 */
export type PointMark = 'target' | 'auto' | 'declared' | 'excluded' | 'none';

const roleLabel = (role: RoadmapPoint['role'], mark?: PointMark) =>
  mark === 'declared' ? '已掌握' : mark === 'excluded' ? '已排除' : mark === 'auto' ? '自动先修' : role === 'target' ? '学习目标' : '先修';

function Marks({ evidence }: { evidence: ('ok' | 'no')[] }) {
  // 最近 5 题：对应掌握标准里的「最近 5 题」
  const recent = evidence.slice(-5);
  return (
    <span className="inline-flex items-center gap-[0.1875rem]" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => <GradeMark key={i} kind={recent[i] ?? 'pending'} size="sm" />)}
    </span>
  );
}

function NodeButton({
  point, evidence, current, lit, mark, onOpen, onFocusChain, onBlurChain, className, style, clamp = false,
}: {
  point: RoadmapPoint; evidence: ('ok' | 'no')[]; current: boolean; lit: boolean | null; mark?: PointMark;
  onOpen?: (id: string) => void; onFocusChain?: (id: string) => void; onBlurChain?: () => void;
  className?: string; style?: React.CSSProperties; clamp?: boolean;
}) {
  const role = roleLabel(point.role, mark);
  const name = `${point.title}，${role}，计入证据 ${evidence.length} 题${current ? '，正在学习' : ''}`;
  return (
    <button
      type="button"
      data-id={point.id}
      data-lit={lit === null ? undefined : String(lit)}
      aria-label={name}
      aria-current={current ? 'step' : undefined}
      onClick={() => onOpen?.(point.id)}
      onFocus={() => onFocusChain?.(point.id)}
      onBlur={() => onBlurChain?.()}
      onPointerEnter={() => onFocusChain?.(point.id)}
      onPointerLeave={() => onBlurChain?.()}
      title={point.title}
      style={style}
      className={cn(
        'relative z-[1] grid min-w-0 content-center gap-0.5 rounded-[var(--radius-paper)] border bg-paper px-3 py-1.5 text-left transition-[border-color,opacity,background-color] duration-150',
        point.role === 'target' || mark === 'target' ? 'border-[#8f8e89]' : 'border-[#dddcd7]',
        mark === 'declared' && 'bg-raised',
        mark === 'excluded' && 'border-dashed opacity-60',
        current && 'border-zhu bg-zhu-tint',
        lit === false && 'opacity-40',
        'hover:border-ink',
        className,
      )}
    >
      <span className={cn('text-[0.84375rem] font-medium leading-snug', clamp && 'line-clamp-2', mark === 'excluded' && 'line-through decoration-void')}>{point.title}</span>
      <span className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{role}</span>
        <Marks evidence={evidence} />
      </span>
    </button>
  );
}

/**
 * 先修路线图：知识点按先修层级从左到右排开，连线是先修关系。
 * 悬停或键盘聚焦一个节点时高亮它的整条先修链。手机上（或 compact=true）渲染为按层分组的列表。
 */
export function Roadmap({
  points, evidence, current, marks, onOpen, compact = 'auto', className, interactive = true,
}: {
  points: RoadmapPoint[];
  evidence: Evidence;
  current?: string;
  marks?: Record<string, PointMark>;
  onOpen?: (id: string) => void;
  compact?: boolean | 'auto';
  className?: string;
  interactive?: boolean;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const asList = compact === 'auto' ? phone : compact;
  const layout = useMemo(() => layoutRoadmap(points), [points]);
  const byId = useMemo(() => new Map(points.map(p => [p.id, p])), [points]);
  const [focus, setFocus] = useState<string | null>(null);
  const chain = useMemo(() => (focus ? ancestors(points, focus) : null), [focus, points]);
  const onFocusChain = useCallback((id: string) => { if (interactive) setFocus(id); }, [interactive]);
  const onBlurChain = useCallback(() => setFocus(null), []);
  const litOf = (id: string) => (chain ? chain.has(id) : null);

  if (asList) {
    return (
      <ol aria-label={`${points.length} 个知识点，按先修层级排列`} className={cn('grid gap-3.5', className)}>
        {layout.columns.map((column, index) => (
          <li key={index}>
            <h3 className="mb-1.5 text-xs font-medium text-muted">第 {index + 1} 层</h3>
            <ul className="grid gap-1.5">
              {column.map(node => {
                const point = byId.get(node.id)!;
                return (
                  <li key={node.id}>
                    <NodeButton
                      point={point}
                      evidence={evidence[node.id] ?? []}
                      current={current === node.id}
                      lit={litOf(node.id)}
                      mark={marks?.[node.id]}
                      onOpen={onOpen}
                      onFocusChain={onFocusChain}
                      onBlurChain={onBlurChain}
                      className="min-h-11 w-full"
                    />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <RoadmapGrid
      layout={layout}
      byId={byId}
      evidence={evidence}
      current={current}
      marks={marks}
      onOpen={onOpen}
      chain={chain}
      onFocusChain={onFocusChain}
      onBlurChain={onBlurChain}
      litOf={litOf}
      className={className}
    />
  );
}

function RoadmapGrid({
  layout, byId, evidence, current, marks, onOpen, chain, onFocusChain, onBlurChain, litOf, className,
}: {
  layout: ReturnType<typeof layoutRoadmap>;
  byId: Map<string, RoadmapPoint>;
  evidence: Evidence;
  current?: string;
  marks?: Record<string, PointMark>;
  onOpen?: (id: string) => void;
  chain: Set<string> | null;
  onFocusChain: (id: string) => void;
  onBlurChain: () => void;
  litOf: (id: string) => boolean | null;
  className?: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ key: string; d: string; from: string; to: string }[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const rowsHalf = Math.max(1, layout.rows * 2);

  // 按节点实际位置画连线；尺寸变化或字体加载后重算
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const box = (id: string) => grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      const next: typeof paths = [];
      for (const point of byId.values()) {
        for (const pre of point.prerequisiteIds) {
          const a = box(pre), b = box(point.id);
          if (!a || !b) continue;
          const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
          const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
          const mx = (x1 + x2) / 2;
          next.push({ key: `${pre}>${point.id}`, from: pre, to: point.id, d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}` });
        }
      }
      setPaths(next);
      setSize({ width: grid.scrollWidth, height: grid.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [byId]);

  return (
    <div className={cn('overflow-x-auto pb-1', className)}>
      <div
        ref={gridRef}
        className="relative grid gap-x-7"
        style={{
          gridTemplateColumns: `repeat(${layout.columns.length}, minmax(9.75rem, 1fr))`,
          gridTemplateRows: `2rem repeat(${rowsHalf}, 2.625rem)`,
        }}
      >
        <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={size.width} height={size.height}>
          {paths.map(path => {
            const lit = chain ? chain.has(path.from) && chain.has(path.to) : false;
            const hot = !chain && path.from === current;
            return (
              <path
                key={path.key}
                d={path.d}
                fill="none"
                className="transition-[stroke,opacity] duration-150"
                stroke={lit ? 'var(--color-ink)' : hot ? 'var(--color-zhu)' : '#d3d2cd'}
                strokeWidth={lit || hot ? 1.4 : 1}
                opacity={chain && !lit ? 0.2 : 1}
              />
            );
          })}
        </svg>
        {layout.columns.map((column, index) => (
          <div key={`h${index}`} className="whitespace-nowrap text-xs text-muted" style={{ gridColumn: index + 1, gridRow: 1 }}>
            第 {index + 1} 层 · {column.length} 个
          </div>
        ))}
        {layout.columns.map((column, index) =>
          column.map(node => {
            const point = byId.get(node.id)!;
            const start = 2 + Math.round((node.row + (layout.rows - 1) / 2) * 2);
            return (
              <NodeButton
                key={node.id}
                point={point}
                evidence={evidence[node.id] ?? []}
                current={current === node.id}
                lit={litOf(node.id)}
                mark={marks?.[node.id]}
                onOpen={onOpen}
                onFocusChain={onFocusChain}
                onBlurChain={onBlurChain}
                clamp
                className="h-[4.75rem] self-center"
                style={{ gridColumn: index + 1, gridRow: `${start} / span 2` }}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
