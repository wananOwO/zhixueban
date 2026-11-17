import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { LearningError } from './contracts';
import { VerifiedLearningStore } from './store';
import { errorSignature } from './trace';

/**
 * 示例课程（规格 8.4）：从一个已生成好的模板空间导出一门课，复制到每个新的线上空间，
 * 评委不填 Key 也能浏览课件、答题、看生成回放。
 *
 * 导出：课程活跃版本涉及的资料与来源快照、课程版本、方案审核记录、确认它的草稿、
 * 一个干净的学习会话（未开始任何活动），已生成的课件与题组（题组标为 prepared：已生成未开始），
 * 生成课程方案、课件、题组的任务（只保留终态与结果，input_json 置为 {}）、任务事件，
 * Agent 会话记录只保留 buildTrace 需要的工具调用与结果状态（不含提示、模型文字、引文、工具反馈原文）。
 * 不导出：作答、提示、笔记、请求幂等记录、学习事件、草稿以外的其他草稿、上传文件本身。
 *
 * 种入：单事务，所有 ID 保留原值（各表主键都含 scope_id，不同空间不冲突）；重复种入幂等。
 */
export interface SampleBundle {
  version: 1;
  courseId: string;
  tables: Record<SampleTable, Record<string, unknown>[]>;
}

/** 按外键依赖顺序：父表在前 */
const TABLES = [
  'vl_books', 'vl_source_revisions',
  'vl_course_versions', 'vl_course_reviews', 'vl_drafts',
  'vl_study_sessions', 'vl_activity_runs', 'vl_questions',
  'vl_jobs', 'vl_job_events', 'vl_agent_states',
] as const;
type SampleTable = (typeof TABLES)[number];

/** 每张表允许写入的列（白名单）：导入时拒绝任何别的列名，防止拼接 SQL */
const COLUMNS: Record<SampleTable, readonly string[]> = {
  vl_books: ['book_id', 'origin', 'legacy_id', 'file_relpath', 'file_hash', 'status', 'archived_at', 'revision', 'created_at'],
  vl_source_revisions: ['book_id', 'source_revision', 'snapshot_json', 'created_at', 'revoked_at'],
  vl_course_versions: ['version_id', 'course_id', 'status', 'snapshot_json'],
  vl_course_reviews: ['version_id', 'draft_id', 'proposal_json', 'choices_json', 'report_json', 'teaching_json'],
  vl_drafts: ['draft_id', 'revision', 'input_json', 'state', 'generation_job_id', 'generated_revision', 'version_id', 'review_json', 'confirmed_json', 'created_at', 'updated_at'],
  vl_study_sessions: ['session_id', 'version_id', 'revision', 'state_json'],
  vl_activity_runs: ['run_id', 'session_id', 'version_id', 'activity_id', 'activity_json', 'purpose', 'status', 'content_json', 'job_id', 'created_at'],
  vl_questions: ['question_id', 'run_id', 'snapshot_json'],
  vl_jobs: ['job_id', 'kind', 'idempotency_key', 'input_json', 'status', 'stage', 'attempts', 'checkpoint_json', 'result_json', 'error_json', 'event_cursor', 'created_at', 'updated_at'],
  vl_job_events: ['job_id', 'cursor', 'stage', 'message', 'created_at'],
  vl_agent_states: ['job_id', 'stage_id', 'messages_json', 'artifacts_json', 'requests', 'in_flight', 'model_json', 'updated_at'],
};

const bundleSchema = z.strictObject({
  version: z.literal(1),
  courseId: z.string().min(1).max(200),
  tables: z.strictObject(Object.fromEntries(TABLES.map(t => [t, z.array(z.record(z.string(), z.unknown())).max(100_000)])) as Record<SampleTable, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>),
});

type Row = Record<string, unknown>;
/** 只导出白名单列（去掉 scope_id、租约等运行时字段） */
const pick = (table: SampleTable) => (row: Row): Row => Object.fromEntries(COLUMNS[table].filter(c => c in row).map(c => [c, row[c]]));

/** Agent 会话记录脱敏：只保留 buildTrace 读取的字段 */
function traceOnlyMessages(json: string): string {
  let messages: { role?: string; timestamp?: number; content?: unknown; toolCallId?: string; isError?: boolean }[];
  try { messages = JSON.parse(json); } catch { return '[]'; }
  const kept = messages.flatMap((message): Row[] => {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const calls = message.content.filter((part: { type?: string }) => part?.type === 'toolCall').map((part: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
        type: 'toolCall', id: part.id, name: part.name, arguments: traceArgs(part.name, part.arguments ?? {}),
      }));
      return calls.length ? [{ role: 'assistant', timestamp: message.timestamp, content: calls }] : [];
    }
    if (message.role === 'toolResult') {
      // 结果正文只给 read_source 用来求真实段号区间：只留段号；错误反馈只留类别关键词
      return [{ role: 'toolResult', toolCallId: message.toolCallId, timestamp: message.timestamp, isError: message.isError === true, content: [{ type: 'text', text: resultSummary(message) }] }];
    }
    return [];
  });
  return JSON.stringify(kept);
}

/** 只保留轨迹会展示的参数 */
function traceArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
  const cites = Array.isArray(args.citations)
    ? args.citations.map(c => { const item = c as Record<string, unknown>; return { sourceId: item.sourceId, paragraphIndex: item.paragraphIndex }; })
    : undefined;
  switch (tool) {
    case 'search_sources': case 'search_web': return pick('query');
    case 'read_source': return pick('sourceId', 'chapterId', 'offset', 'limit');
    case 'fetch_web_source': return pick('url');
    case 'submit_lesson_section': return { ...pick('sectionId'), ...(cites ? { citations: cites } : {}) };
    case 'submit_curriculum_point': return { ...pick('id'), ...(cites ? { citations: cites } : {}) };
    case 'submit_question': return pick('index');
    default: return {};
  }
}

function resultSummary(message: { content?: unknown; isError?: boolean }): string {
  const text = Array.isArray(message.content) ? message.content.map(p => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : '')).join('') : '';
  if (message.isError) return errorSignature(text);
  try {
    const parsed = JSON.parse(text) as { paragraphs?: { paragraphIndex?: unknown }[]; total?: unknown; keywordCount?: unknown; vectorCount?: unknown; degraded?: unknown };
    if (Array.isArray(parsed.paragraphs)) return JSON.stringify({ paragraphs: parsed.paragraphs.map(p => ({ paragraphIndex: p.paragraphIndex })) });
    if (typeof parsed.total === 'number' && typeof parsed.keywordCount === 'number' && typeof parsed.vectorCount === 'number') {
      return JSON.stringify({ total: parsed.total, keywordCount: parsed.keywordCount, vectorCount: parsed.vectorCount, degraded: parsed.degraded === true });
    }
  } catch { /* 非 JSON 结果不保留 */ }
  return '';
}

export function exportSample(db: Database.Database, fromScope: string, courseId: string): SampleBundle {
  const store = new VerifiedLearningStore(db);
  const version = db.prepare("SELECT * FROM vl_course_versions WHERE scope_id=? AND course_id=? AND status='active'").get(fromScope, courseId) as Row | undefined;
  if (!version) throw new LearningError('NOT_FOUND', '模板空间没有这门课程的活跃版本');
  const versionId = String(version.version_id);
  const snapshot = store.getVersion(fromScope, versionId);
  const sourceIds = snapshot.sourceRevisions.map(s => s.sourceId);
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(fromScope, ...params) as Row[];

  const books = sourceIds.flatMap(id => all('SELECT * FROM vl_books WHERE scope_id=? AND book_id=?', id));
  const revisions = snapshot.sourceRevisions.flatMap(s => all('SELECT * FROM vl_source_revisions WHERE scope_id=? AND book_id=? AND source_revision=?', s.sourceId, s.sourceRevision));
  const review = all('SELECT * FROM vl_course_reviews WHERE scope_id=? AND version_id=?', versionId);
  const drafts = all("SELECT * FROM vl_drafts WHERE scope_id=? AND state='confirmed' AND version_id=?", versionId);
  const session = all('SELECT * FROM vl_study_sessions WHERE scope_id=? AND version_id=? ORDER BY rowid DESC LIMIT 1', versionId)[0];
  if (!session) throw new LearningError('NOT_FOUND', '模板课程没有学习会话');

  // 已生成内容：每个活动取最新一份有内容的课件或有题目的题组
  const runs = all("SELECT * FROM vl_activity_runs WHERE scope_id=? AND session_id=? AND status IN ('ready','completed') ORDER BY rowid", session.session_id);
  const byActivity = new Map<string, Row>();
  for (const run of runs) {
    const kind = (JSON.parse(String(run.activity_json)) as { kind: string }).kind;
    const usable = kind === 'lesson' ? !!run.content_json : (db.prepare('SELECT 1 FROM vl_questions WHERE scope_id=? AND run_id=?').get(fromScope, run.run_id) !== undefined);
    if (usable && run.purpose === 'scheduled') byActivity.set(String(run.activity_id), run);
  }
  const contentRuns = [...byActivity.values()];
  // 干净会话：未开始任何活动；第一份已生成内容作为当前活动（可以直接阅读），其余标 prepared
  const state = JSON.parse(String(session.state_json));
  const first = contentRuns[0];
  const cleanState = {
    ...state, revision: 0, completedActivityIds: [], abandonedActivityIds: [], displayedKnowledgePointIds: [], practiceCompletedKnowledgePointIds: [],
    currentActivity: first ? JSON.parse(String(first.activity_json)) : null,
  };
  const runRows = contentRuns.map(run => ({ ...run, status: run === first ? 'ready' : 'prepared' }));
  const questions = contentRuns.flatMap(run => all('SELECT * FROM vl_questions WHERE scope_id=? AND run_id=? ORDER BY rowid', run.run_id));

  const planJobs = drafts.map(d => d.generation_job_id).filter((id): id is string => typeof id === 'string');
  const jobIds = [...new Set([...planJobs, ...contentRuns.map(r => r.job_id).filter((id): id is string => typeof id === 'string')])];
  const jobs: Row[] = jobIds.flatMap(id => all("SELECT * FROM vl_jobs WHERE scope_id=? AND job_id=? AND status IN ('succeeded','waiting_user')", id))
    .map(job => ({ ...job, input_json: '{}', checkpoint_json: null, error_json: null }));
  const exported = new Set(jobs.map(j => String(j.job_id)));
  const events = [...exported].flatMap(id => all('SELECT * FROM vl_job_events WHERE scope_id=? AND job_id=? ORDER BY cursor', id));
  const agents = [...exported].flatMap(id => all('SELECT * FROM vl_agent_states WHERE scope_id=? AND job_id=? ORDER BY rowid', id))
    .map(row => ({ ...row, messages_json: traceOnlyMessages(String(row.messages_json)), artifacts_json: '{}', in_flight: 0, model_json: null }));

  return {
    version: 1,
    courseId,
    tables: {
      // 示例教材没有上传文件：不占空间的上传额度，用户自己再上传同一本书也不冲突
      vl_books: books.map(book => ({ ...book, file_relpath: null, file_hash: null })).map(pick('vl_books')),
      vl_source_revisions: revisions.map(pick('vl_source_revisions')),
      vl_course_versions: [pick('vl_course_versions')(version)],
      vl_course_reviews: review.map(pick('vl_course_reviews')),
      vl_drafts: drafts.map(pick('vl_drafts')),
      vl_study_sessions: [pick('vl_study_sessions')({ ...session, revision: 0, state_json: JSON.stringify(cleanState) })],
      vl_activity_runs: runRows.map(pick('vl_activity_runs')),
      vl_questions: questions.map(pick('vl_questions')),
      vl_jobs: jobs.map(pick('vl_jobs')),
      vl_job_events: events.map(pick('vl_job_events')),
      vl_agent_states: agents.map(pick('vl_agent_states')),
    },
  };
}

/** 把示例课程写进空间；已有同一门课时跳过。返回是否写入 */
export function seedSample(db: Database.Database, scope: string, input: SampleBundle): boolean {
  const bundle = bundleSchema.parse(input) as SampleBundle;
  for (const table of TABLES) {
    for (const row of bundle.tables[table]) {
      for (const column of Object.keys(row)) if (!COLUMNS[table].includes(column)) throw new LearningError('INVALID_INPUT', `示例课程包含未知字段 ${table}.${column}`);
    }
  }
  return db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM vl_course_versions WHERE scope_id=? AND course_id=?').get(scope, bundle.courseId);
    if (!exists) {
      for (const table of TABLES) {
        for (const row of bundle.tables[table]) {
          const columns = ['scope_id', ...Object.keys(row)];
          const sql = `INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
          db.prepare(sql).run(scope, ...Object.values(row).map(v => (v === undefined ? null : v)));
        }
      }
    }
    db.prepare('UPDATE vl_spaces SET sample_seeded=1 WHERE space_id=?').run(scope);
    return !exists;
  }).immediate();
}

/** 线上新空间：按 VL_SAMPLE_PATH 种入示例课程；未配置、文件缺失或格式错误时跳过（线上站照常可用） */
export function seedFromEnv(db: Database.Database, scope: string, env: Record<string, string | undefined> = process.env): boolean {
  const file = env.VL_SAMPLE_PATH;
  if (!file || !existsSync(file)) return false;
  try {
    return seedSample(db, scope, JSON.parse(readFileSync(file, 'utf8')) as SampleBundle);
  } catch {
    console.error('示例课程种入失败，已跳过');
    return false;
  }
}
