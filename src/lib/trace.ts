import type { JobEvent } from './api/types';

/** 与后端 trace.ts 的 TraceView 对应（前端只读） */
export interface TraceStep {
  at: number;
  tool: string;
  label: string;
  ok: boolean;
  read?: { sourceId: string; chapterId: string; from: number; to: number };
  search?: string;
  cites?: { sourceId: string; paragraphIndex: number }[];
  section?: string;
  question?: number;
  url?: string;
  error?: string;
}
export interface TraceView {
  stages: { stageId: string; requests: number; steps: TraceStep[] }[];
  sources: { sourceId: string; title: string; paragraphs: number }[];
}

export interface TraceSummary {
  steps: TraceStep[];
  reads: number;
  searches: number;
  submits: number;
  fixes: number;
  requests: number;
  /** 每个来源：读过的区间与引用段号 */
  perSource: { sourceId: string; title: string; paragraphs: number; reads: [number, number][]; cites: number[] }[];
}

const SUBMIT_TOOLS = new Set(['submit_curriculum_point', 'submit_lesson_section', 'submit_question']);

/** 汇总轨迹：读取次数、搜索次数、提交次数、自动修正次数，以及每本资料的书带数据 */
export function summarizeTrace(trace: TraceView | undefined): TraceSummary {
  const steps = (trace?.stages ?? []).flatMap(s => s.steps);
  const perSource = (trace?.sources ?? []).map(source => ({
    ...source,
    reads: steps.flatMap(s => (s.read && s.read.sourceId === source.sourceId ? [[s.read.from, s.read.to] as [number, number]] : [])),
    cites: steps.flatMap(s => (s.ok ? (s.cites ?? []).filter(c => c.sourceId === source.sourceId).map(c => c.paragraphIndex) : [])),
  }));
  return {
    steps,
    reads: steps.filter(s => s.tool === 'read_source').length,
    searches: steps.filter(s => s.tool === 'search_sources' || s.tool === 'search_web').length,
    submits: steps.filter(s => SUBMIT_TOOLS.has(s.tool) && s.ok).length,
    fixes: steps.filter(s => !s.ok).length,
    requests: (trace?.stages ?? []).reduce((n, s) => n + s.requests, 0),
    perSource,
  };
}

/** 合并多个任务的轨迹（课程主页：方案、课件、题组任务合在一起画书带）；来源按 sourceId 去重 */
export function mergeTraces(traces: (TraceView | undefined)[]): TraceView {
  const sources = new Map<string, TraceView['sources'][number]>();
  const stages: TraceView['stages'] = [];
  for (const trace of traces) {
    if (!trace) continue;
    stages.push(...trace.stages);
    for (const source of trace.sources) if (!sources.has(source.sourceId)) sources.set(source.sourceId, source);
  }
  return { stages, sources: [...sources.values()] };
}

/** 执行记录一行的说明：在事件标题后补上轨迹里的细节（搜索词、读取范围） */
export function describeStep(step: TraceStep, titleOf: (sourceId: string) => string): string {
  if (step.read) return `${step.label}：${titleOf(step.read.sourceId)} 第 ${step.read.from}–${step.read.to} 段`;
  if (step.search) return `${step.label}：「${step.search}」`;
  if (step.url) return `${step.label}：${step.url}`;
  if (step.question) return `${step.label}：第 ${step.question} 题`;
  if (step.section && step.cites?.length) return `${step.label}：引用原文 ${step.cites.length} 处`;
  return step.label;
}

/** 事件与轨迹都没有时的退路：直接用事件文本 */
export function eventLines(events: JobEvent[]): { key: string; at?: string; text: string; ok: boolean }[] {
  return events.map(e => ({ key: `e${e.cursor}`, at: e.createdAt, text: e.message, ok: !/失败|问题|修正/.test(e.message) }));
}
