'use client';

import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface Activity {
  tool: string;
  input: string;
}

/** Agent 活动面板：展示调用了什么工具、传了什么参数（设计 §5.7：不伪造思考过程） */
export default function AgentActivity({ activities, failures }: { activities: Activity[]; failures?: string[] }) {
  const [open, setOpen] = useState(false);

  if (activities.length === 0 && !failures?.length) return null;

  return (
    <div className="mt-4 rounded-md border border-border text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:bg-muted"
      >
        {open ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
        <Bot aria-hidden className="h-4 w-4" />
        Agent 活动记录（{activities.length} 次工具调用{failures?.length ? `，${failures.length} 个工具不可用` : ''}）
      </button>
      {open && (
        <ul className="grid gap-2 border-t border-border p-3">
          {activities.map((a, i) => (
            <li key={i} className="rounded bg-muted px-3 py-2 font-mono text-xs">
              <span className="font-semibold text-accent">{a.tool}</span>
              <span className="ml-2 text-muted-foreground">{a.input}</span>
            </li>
          ))}
          {failures?.map((f) => (
            <li key={f} className="rounded bg-warning/10 px-3 py-2 text-xs text-warning">
              {f} — 已降级使用已有资料
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
