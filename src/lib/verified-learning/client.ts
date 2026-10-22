/**
 * 浏览器端 verified-learning API 客户端。
 * 约定见 docs/verified-learning/frontend-handoff.md「前端请求约定」：
 * 信封 {contractVersion,requestId,data} / 错误 {error:{code,message,retryable}}。
 */
export class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const base = '/api/verified-learning/v1';

export async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base + path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '网络错误，请检查连接后重试', true);
  }
  const envelope = (await response.json().catch(() => null)) as
    | { data?: unknown; error?: { code?: string; message?: string; retryable?: boolean } }
    | null;
  if (!response.ok) {
    const err = envelope?.error ?? {};
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('vl:unauthorized'));
    }
    throw new ApiError(
      response.status,
      err.code ?? 'UNKNOWN',
      err.message ?? `请求失败（${response.status}）`,
      err.retryable ?? response.status >= 500,
    );
  }
  return envelope?.data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}

// ---------- 与后端契约对应的类型（以 handoff 文档与 route.ts 为准） ----------

export interface BookChapter {
  id: string;
  title: string;
  characterCount: number;
}
export interface BookView {
  bookId: string;
  title: string;
  format: string;
  status: string;
  archived: boolean;
  revision: number;
  sourceRevision: string;
  createdAt: string;
  chapters: BookChapter[];
}
export interface SourceParagraph {
  paragraphIndex: number;
  text: string;
  contentHash: string;
}
export interface SourceSnapshotView {
  sourceId: string;
  sourceRevision: string;
  title: string;
  format: string;
  chapters: { chapterId: string; title: string; paragraphs: SourceParagraph[] }[];
}
export interface ChapterPage {
  chapterId: string;
  title: string;
  paragraphs: SourceParagraph[];
  nextOffset: number | null;
}
export interface DeletionImpact {
  bookId: string;
  revision: number;
  blocked: boolean;
  blockers: { kind: string; id: string }[];
}
export interface JobView {
  jobId: string;
  kind: string;
  status: 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  eventCursor: number;
  attempts: number;
  result: unknown;
  error: { code: string; message: string } | null;
  resumable: boolean;
}
export interface JobEvent {
  cursor: number;
  message: string;
  at?: string;
}

export type LearningModeName = 'theory' | 'practice' | 'drill';
export type ProgrammingLanguageName = 'python' | 'javascript' | 'c';

export interface AssessmentInput {
  pointQuestionCount: number;
  chapterQuestionCount: number;
  finalQuestionCount: number;
  difficulty: 'easy' | 'medium' | 'hard';
  progressionPolicy: string;
}
export interface DraftSource {
  sourceId: string;
  sourceRevision: string;
  chapterIds: string[];
}
export interface DraftInputShape {
  title: string;
  textbookId: string | null;
  sources: DraftSource[];
  goal: string;
  teachingPrompt: string;
  priorKnowledgeText: string;
  includedTopics: string[];
  excludedTopics: string[];
  allowSupplementalSources: boolean;
  assessment: AssessmentInput;
  mode: LearningModeName;
  subjectType: string;
  programmingLanguage: ProgrammingLanguageName | null;
  templateId: string | null;
}
export interface ReviewIssue {
  code: string;
  knowledgePointIds: string[];
  message: string;
}
export interface ReviewReport {
  input: DraftInputShape;
  issues: ReviewIssue[];
  includedIds: string[];
  skippedIds: string[];
  decisions: unknown[];
}
export interface ProposalPoint {
  id: string;
  title: string;
  prerequisiteIds: string[];
  relatedIds: string[];
  citations: CitationView[];
}
export interface ReviewView {
  proposal: { points: ProposalPoint[]; targetIds: string[]; declaredIds: string[] } | null;
  choices: ChoicesShape | null;
  report: ReviewReport | null;
  input: DraftInputShape | null;
  jobId: string | null;
  stale: boolean;
}
export interface FormDraft {
  draftId: string;
  revision: number;
  input: DraftInputShape;
  state: 'editing' | 'generating' | 'review' | 'confirmed' | 'discarded';
  generationJobId: string | null;
  generatedFromRevision: number | null;
  versionId: string | null;
  review: ReviewView | null;
  confirmed: { courseId: string; versionId: string; sessionId: string } | null;
}
export interface ChoicesShape {
  targetIds: string[];
  excludedIds: string[];
  declaredIds: string[];
  order: string[] | null;
  prerequisiteEdits: { pointId: string; prerequisiteIds: string[]; reason: string }[];
  supplementalSourceIds: string[];
}
export interface TemplateView {
  templateId: string;
  revision: number;
  name: string;
  content: string;
  subjectType?: string;
}
export interface CourseListItem {
  courseId: string;
  versionId: string;
  status: string;
  sessionId?: string;
  snapshot: {
    goal?: string;
    mode?: LearningModeName;
    textbookId?: string;
    outline?: { moduleId: string; title: string; points: CoursePointView[] }[];
  };
}

export interface CitationView {
  sourceId: string;
  sourceRevision: string;
  chapterId: string;
  paragraphIndex: number;
  quote: string;
}
export interface ActivityShape {
  activityId: string;
  kind: 'lesson' | 'point_quiz' | 'chapter_quiz' | 'final_quiz' | 'diagnostic';
  moduleId: string | null;
  knowledgePointIds: string[];
  questionCount: number;
}
export type NextShape =
  | { kind: 'activity'; activity: ActivityShape }
  | { kind: 'blocked'; reason: 'PRIOR_KNOWLEDGE_REQUIRED' | 'MASTERY_REQUIRED'; knowledgePointIds: string[] }
  | { kind: 'done' };
export interface CoursePointView {
  knowledgePointId: string;
  title: string;
  prerequisiteIds: string[];
  sourceIds: string[];
  role: 'target' | 'prerequisite' | 'supplement';
  coverage: 'covered' | 'missing' | 'supplemented';
  reason: string;
}
export interface SessionView {
  session: {
    sessionId: string;
    courseId: string;
    courseVersionId: string;
    mode: LearningModeName;
    revision: number;
    completedActivityIds: string[];
  };
  version: {
    courseId: string;
    courseVersionId: string;
    goal: string;
    outline: { moduleId: string; title: string; points: CoursePointView[] }[];
  };
  next: NextShape;
  currentRun: { runId: string; status: string; activity: ActivityShape; jobId: string | null } | null;
  cursor: {
    revision: number;
    runId?: string;
    blockId?: string;
    offset?: number;
    answers?: Record<string, string>;
  } | null;
}
export interface RunQuestion {
  questionId: string;
  type: 'choice' | 'fill' | 'code';
  stem: string;
  options?: string[];
  language?: ProgrammingLanguageName;
  samples?: { stdin: string; expectedStdout: string }[];
  attempt: { attemptId: string; state: string; result: AttemptResult | null } | null;
}
export interface RunView {
  runId: string;
  status: string;
  activity: ActivityShape;
  content: { markdown: string; citations: CitationView[] } | null;
  questions: RunQuestion[];
}
export interface AttemptResult {
  correct: boolean;
  feedback: string;
  explanation?: string;
  category: string;
}
export interface AttemptView {
  attemptId: string;
  questionId: string;
  state: 'pending' | 'running' | 'finished' | 'infrastructure_error' | 'unknown';
  result: AttemptResult | null;
}
export interface HistoryRunItem {
  runId: string;
  status: string;
  activity: ActivityShape;
  createdAt: string;
}
export interface HistoryRunDetail extends RunView {
  questions: (RunQuestion & { answer?: string; explanation?: string })[];
}
export interface NoteView {
  noteId: string;
  courseId: string;
  versionId: string;
  knowledgePointId: string;
  revision: number;
  content: string;
}
export interface ProgressView {
  courseId: string;
  versionId: string;
  completedActivities: number;
  attempts: { total: number; correct: number };
  dailyActivity: { date: string; count: number }[];
  verifiedKnowledgePointIds: string[];
  knowledgePoints: { knowledgePointId: string; title: string; verified: boolean }[];
}
