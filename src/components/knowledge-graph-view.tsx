'use client';

import { useMemo } from 'react';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MasteryTier } from '@/lib/stats';

const TIER_COLOR: Record<MasteryTier, string> = {
  green: '#17a34a',
  yellow: '#f59e0b',
  red: '#dc2626',
  gray: '#d4d4d4',
};

interface Props {
  nodes: { id: string; title: string; mastery: number; tier: MasteryTier }[];
  edges: { fromId: string; toId: string }[];
}

/** 知识图谱：React Flow 交互图 + 等价列表视图（无障碍） */
export default function KnowledgeGraphView({ nodes, edges }: Props) {
  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 4) * 200, y: Math.floor(i / 4) * 100 },
        data: { label: `${n.title}（${Math.round(n.mastery * 100)}%）` },
        style: {
          border: `2px solid ${TIER_COLOR[n.tier]}`,
          borderRadius: 8,
          padding: 8,
          fontSize: 12,
          background: 'var(--background)',
          color: 'var(--foreground)',
        },
      })),
    [nodes],
  );
  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: `${e.fromId}-${e.toId}`,
        source: e.fromId,
        target: e.toId,
        markerEnd: { type: 'arrowclosed' as const },
      })),
    [edges],
  );

  return (
    <div>
      <div style={{ height: 400 }} className="rounded-lg border border-border" role="img" aria-label="知识掌握图谱">
        <ReactFlow nodes={flowNodes} edges={flowEdges} fitView proOptions={{ hideAttribution: false }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground" aria-hidden>
        <span>🟢 已掌握</span>
        <span>🟡 在学</span>
        <span>🔴 薄弱</span>
        <span>⚪ 未解锁</span>
      </div>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary>查看文本版知识点列表</summary>
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              {n.title}：掌握度 {Math.round(n.mastery * 100)}%（
              {{ green: '已掌握', yellow: '在学', red: '薄弱', gray: '未解锁' }[n.tier]}）
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
