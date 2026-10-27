/**
 * 前后端契约类型（以 docs/verified-learning/frontend-handoff.md 与 route.ts 为准）。
 * 由第一版 src/lib/verified-learning/client.ts 迁移，字段保持不变。
 */

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
  blockers: { kind: string; id: string; courseId?: string; status?: string }[];
}
export type JobStatus = 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
export interface JobView {
  jobId: string;
  kind: string;
  status: JobStatus;
  stage: string;
  eventCursor: number;
  attempts: number;
  result: unknown;
  error: { code: string; message: string; retryable?: boolean } | null;
  resumable: boolean;
}
export interface JobEvent {
  cursor: number;
  stage?: string;
  message: string;
  createdAt?: string;
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
  updatedAt?: string;
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
    createdAt?: string;
    outline?: { moduleId: string; title: string; points: CoursePointView[] }[];
    sourceRevisions?: { sourceId: string; sourceRevision: string }[];
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
  /** 每个知识点最近 5 道计入证据的不同题的对错（按时间先后）；任务 11 新增 */
  recent?: Record<string, boolean[]>;
}
export interface ModeView {
  mode: 'local' | 'online';
  uploadLimitBytes: number;
  booksPerSpace: number | null;
}
export type SettingsView = Record<string, string | boolean>;
