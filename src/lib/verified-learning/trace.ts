import type Database from 'better-sqlite3';
import { LearningError } from './contracts';

/**
 * Agent 执行轨迹（规格 8.2）：从 vl_agent_states 的会话记录提取工具调用摘要，
 * 用于「书带」与执行记录。只保留白名单字段：工具名、读取区间、搜索词、引用段号、题号、校验错误摘要。
 * 不返回：系统提示、模型文字输出、课件正文与引文、题目内容、答案、解析、参考解、测试用例、Key。
 */
export interface TraceStep {
  at: number;
  tool: string;
  label: string;
  ok: boolean;
  read?: { sourceId: string; chapterId: string; from: number; to: number };
  search?: string;
  searchStats?: { total: number; keywordCount: number; vectorCount: number; degraded: boolean };
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

const LABELS: Record<string, string> = {
  list_sources: '查看资料目录', search_sources: '搜索资料', read_source: '读取原文',
  search_web: '搜索公开资料', fetch_web_source: '保存公开来源', get_generation_state: '核对已生成内容',
  submit_curriculum_point: '提交知识点', plan_lesson: '规划课件小节', submit_lesson_section: '撰写并验收课件小节',
  submit_question: '出题并审校', submit_review: '提交审校结论', finish_generation: '验收', report_blocker: '报告客观阻塞',
};

interface ToolCall { type: 'toolCall'; id: string; name: string; arguments?: Record<string, unknown> }
interface Message { role: string; timestamp?: number; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean }

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
const int = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);

function resultText(message: Message | undefined): string {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content.map(part => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '')).join('');
}

/** 校验错误摘要：只说明哪类问题，不转述工具反馈原文（可能包含字段名或模型提交的内容） */
const ERROR_KINDS: [RegExp, string][] = [
  [/QUOTE_MISMATCH/, '引文与原文不一致，Agent 重新读取原文修正'],
  [/ANCHOR_MISSING/, '引用的段落不存在，Agent 重新定位'],
  [/SOURCE_MISSING|REVISION_MISMATCH/, '引用的资料版本不对，Agent 重新核对'],
  [/判题|Judge0/, '判题服务不可用，编程题未通过验收'],
  [/题量|题号/, '题量或题号不符，Agent 继续补齐'],
  [/审校|答案不唯一|超出/, '题目未通过审校，Agent 修改后重交'],
  [/缺少概念|例子|总结|小节/, '课件内容不完整，Agent 补写对应小节'],
  [/先修|循环/, '先修关系有问题，Agent 调整'],
  [/参数不符合|Schema|JSON/i, '提交格式不对，Agent 按要求重交'],
  [/缺来源|公开资料/, '资料不足，Agent 补充公开来源'],
];
function errorKind(text: string): string {
  for (const [pattern, label] of ERROR_KINDS) if (pattern.test(text)) return label;
  return '校验未通过，Agent 自动修正';
}
/** 工具反馈里决定错误类别的关键词（示例课程导出时用它代替反馈原文，类别判定不变） */
export function errorSignature(text: string): string {
  return ERROR_KINDS.flatMap(([pattern]) => pattern.exec(text)?.[0] ?? []).join(' ');
}

function citesOf(value: unknown): TraceStep['cites'] {
  if (!Array.isArray(value)) return undefined;
  const list = value.flatMap(item => {
    const sourceId = str((item as Record<string, unknown>)?.sourceId, 200);
    const paragraphIndex = int((item as Record<string, unknown>)?.paragraphIndex);
    return sourceId !== undefined && paragraphIndex !== undefined ? [{ sourceId, paragraphIndex }] : [];
  });
  return list.length ? list : undefined;
}

/** read_source 的真实读取范围：优先取返回段落的段号，结果不可解析时退回 offset..offset+limit-1 */
function readRange(args: Record<string, unknown>, result: string): TraceStep['read'] {
  const sourceId = str(args.sourceId, 200);
  const chapterId = str(args.chapterId, 200);
  if (!sourceId || !chapterId) return undefined;
  try {
    const parsed = JSON.parse(result) as { paragraphs?: { paragraphIndex?: unknown }[] };
    const indices = (parsed.paragraphs ?? []).map(p => int(p.paragraphIndex)).filter((n): n is number => n !== undefined);
    if (indices.length) return { sourceId, chapterId, from: Math.min(...indices), to: Math.max(...indices) };
  } catch { /* 结果被截断或为错误文本 */ }
  const offset = int(args.offset) ?? 0;
  const limit = int(args.limit) ?? 10;
  return { sourceId, chapterId, from: offset, to: offset + Math.max(1, limit) - 1 };
}

function step(call: ToolCall, result: Message | undefined, at: number): TraceStep {
  const args = call.arguments ?? {};
  const text = resultText(result);
  const ok = result ? !result.isError : true;
  const base: TraceStep = { at, tool: call.name, label: LABELS[call.name] ?? call.name, ok };
  if (!ok) base.error = errorKind(text);
  switch (call.name) {
    case 'search_sources': {
      base.search = str(args.query, 120);
      if (ok && text) {
        try {
          const parsed = JSON.parse(text) as { total?: unknown; keywordCount?: unknown; vectorCount?: unknown; degraded?: unknown };
          const total = int(parsed.total);
          const keywordCount = int(parsed.keywordCount);
          const vectorCount = int(parsed.vectorCount);
          if (total !== undefined && keywordCount !== undefined && vectorCount !== undefined) {
            base.searchStats = { total, keywordCount, vectorCount, degraded: parsed.degraded === true };
          }
        } catch { /* 非结构化返回不提取统计 */ }
      }
      break;
    }
    case 'search_web':
      base.search = str(args.query, 120);
      break;
    case 'read_source':
      base.read = readRange(args, text);
      break;
    case 'fetch_web_source':
      base.url = str(args.url, 300);
      break;
    case 'submit_lesson_section':
      base.section = str(args.sectionId, 80);
      base.cites = citesOf(args.citations);
      break;
    case 'submit_curriculum_point':
      base.section = str(args.id, 80);
      base.cites = citesOf(args.citations);
      break;
    case 'submit_question':
      base.question = int(args.index);
      break;
  }
  return base;
}

export function buildTrace(db: Database.Database, scope: string, jobId: string): TraceView {
  const job = db.prepare('SELECT 1 FROM vl_jobs WHERE scope_id=? AND job_id=?').get(scope, jobId);
  if (!job) throw new LearningError('NOT_FOUND', '任务不存在');
  const rows = db.prepare('SELECT stage_id, messages_json, requests FROM vl_agent_states WHERE scope_id=? AND job_id=? ORDER BY rowid')
    .all(scope, jobId) as { stage_id: string; messages_json: string; requests: number }[];
  const sourceIds = new Set<string>();
  const stages = rows.map(row => {
    let messages: Message[] = [];
    try { messages = JSON.parse(row.messages_json); } catch { messages = []; }
    const results = new Map(messages.filter(m => m.role === 'toolResult' && m.toolCallId).map(m => [m.toolCallId!, m]));
    const steps: TraceStep[] = [];
    for (const message of messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
      for (const part of message.content as ToolCall[]) {
        if (part?.type !== 'toolCall' || typeof part.name !== 'string') continue;
        const result = results.get(part.id);
        const item = step(part, result, result?.timestamp ?? message.timestamp ?? 0);
        if (item.read) sourceIds.add(item.read.sourceId);
        for (const cite of item.cites ?? []) sourceIds.add(cite.sourceId);
        steps.push(item);
      }
    }
    return { stageId: row.stage_id, requests: row.requests, steps };
  });
  const sources = [...sourceIds].flatMap(sourceId => {
    const saved = db.prepare('SELECT snapshot_json FROM vl_source_revisions WHERE scope_id=? AND book_id=? ORDER BY created_at DESC LIMIT 1')
      .get(scope, sourceId) as { snapshot_json: string } | undefined;
    if (!saved) return [];
    const snapshot = JSON.parse(saved.snapshot_json) as { title: string; chapters: { paragraphs: unknown[] }[] };
    return [{ sourceId, title: snapshot.title, paragraphs: snapshot.chapters.reduce((n, c) => n + c.paragraphs.length, 0) }];
  });
  return { stages, sources };
}
