# Verified Learning Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first approved slice: compatible data contracts, immutable course snapshots, a three-mode learning state core, and isolated persistence.

**Architecture:** Keep the existing application and its HTTP routes unchanged. New pure functions validate course snapshots and compute/reduce session state; an explicit SQLite store adds only `vl_` tables. No model, browser, external connector, or code executor is required to test this slice.

**Tech Stack:** Existing TypeScript, Zod 4, Vitest, better-sqlite3, Node.js; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-verified-learning-design.md`; `docs/contracts/verified-learning-v1.md`.

## Global Constraints

- Work only in `E:/code/程序设计比赛-verified-learning`, branch `feat/verified-learning`.
- Reviewed mainline snapshot: `cd591dc`; do not copy uncommitted mainline changes.
- 新业务代码放在 `src/lib/verified-learning/`。
- 新测试放在 `tests/verified-learning/`。
- 数据扩展使用 `vl_` 前缀表和独立迁移记录，不删除或重命名主线表、列。
- 原有 `POST /api/textbooks` 的字段、状态码约定保持原样。
- 模式映射固定为 1/theory、2/practice、3/drill。
- 题量默认值固定为 3、10、10。
- 题数是正整数，首版单次请求上限为 50。
- 时间统一为 UTC ISO 8601，显示时才转换为用户时区。
- 未实现认证的增强 HTTP 接口不进入本切片；scopeId 只由未来服务端认证适配器提供。
- Domain commands recording completions/diagnoses are trusted backend facts, not public request DTOs. A future assessment service must validate actual question membership/results before invoking them.
- No mastery rule or grading engine is introduced here. Reading, declaring prior knowledge, or completing activities never manufactures verified mastery.
- File databases are backed up before the first migration; initialization is explicit, never a side effect of importing a module or running the old application.
- Preserve the existing design system, routes, provider, schema and dependency lockfile.
- Use test-first development; each task includes focused tests followed by the complete test suite.

## Scope And Compatibility

Touched callers: only new core modules, their tests, and the three branch documents.
Exports are direct named exports from their owning module, not an additional barrel.
Existing UI/API callers keep using the old engine. This is deliberately a testable backend slice, not a claim that the enhanced learning UI is available.

Inherited issues remain explicit: legacy upload rollback/multi-book chunk IDs and the existing question response/executor are not repaired by this slice. Enhanced code must not call the old question publisher or executor.

## Task 1: Validated Contracts, Versions And Legacy Adapters

**Files:**
- Create `src/lib/verified-learning/contracts.ts`
- Create `src/lib/verified-learning/course-version.ts`
- Create `src/lib/verified-learning/legacy.ts`
- Create `tests/verified-learning/contracts.test.ts`
- Create `tests/verified-learning/course-version.test.ts`
- Create `tests/verified-learning/fixtures.ts`

**Interfaces:**

```ts
type LearningMode = 'theory' | 'practice' | 'drill';
type LegacyMode = 1 | 2 | 3;
type Difficulty = 'easy' | 'medium' | 'hard';
type ErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'VERSION_CONFLICT'
  | 'VALIDATION_FAILED' | 'ACTIVITY_IN_PROGRESS';
class LearningError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string);
}
interface AssessmentSettings {
  pointQuestionCount: number;
  chapterQuestionCount: number;
  finalQuestionCount: number;
  difficulty: Difficulty;
  progressionPolicy: 'completed' | 'mastery';
}
interface PriorKnowledge {
  knowledgePointId: string;
  source: 'declared' | 'diagnosed';
}
interface CurriculumPointView {
  knowledgePointId: string;
  title: string;
  prerequisiteIds: string[];
  sourceIds: string[];
  role: 'target' | 'prerequisite' | 'supplement';
  coverage: 'covered' | 'missing' | 'supplemented';
  reason: string;
}
interface CourseModuleView {
  moduleId: string;
  title: string;
  points: CurriculumPointView[];
  assessment?: Partial<AssessmentSettings>;
}
interface CourseVersion {
  courseId: string;
  courseVersionId: string;
  engine: 'verified-v1';
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
  textbookId: string;
  goal: string;
  teachingPrompt: string;
  priorKnowledge: PriorKnowledge[];
  includedTopics: string[];
  excludedTopics: string[];
  allowSupplementalSources: boolean;
  assessment: AssessmentSettings;
  outline: CourseModuleView[];
  sourceRevisions: { sourceId: string; sourceRevision: string }[];
}
```

Export Zod-backed `parseAssessment(input: unknown): AssessmentSettings`,
`parseCourseInput(input: unknown): CourseInput`, and `CourseInput` (the course
fields above excluding server IDs, engine, status and time). Defaults:
empty teaching prompt/prior knowledge/topic lists/source revisions; allow
supplemental sources true; difficulty easy; progression completed.
The goal, textbook ID, modules and points are required. IDs must be nonblank
strings and remain opaque; avoid coercion. Reject invalid enums, NaN,
fractions, zero, negative numbers and counts above 50. Reject unknown object
fields at input boundaries. Module assessment overrides inherit omitted fields.

```ts
function createCourseVersion(input: unknown, courseId?: string): CourseVersion;
function reviseCourseVersion(previous: CourseVersion, input: unknown): CourseVersion;
function activateCourseVersion(version: CourseVersion): CourseVersion;
function fromLegacyMode(input: unknown): LearningMode;
function toLegacyMode(input: unknown): LegacyMode;
function toSourceAnchor(anchor: Paragraph['anchor']): {
  chapterId: string; paragraphIndex: number;
};
function toLegacyAnchor(anchor: {
  chapterId: string; paragraphIndex: number;
}): Paragraph['anchor'];
```

Import `Paragraph` from the existing textbook module. Creation and revision
produce new IDs and detached nested values; revisions retain courseId and
leave previous data unchanged. They always begin as drafts. Activation
returns a new snapshot with the same version ID; it does not mutate its input.
Validate unique module, point and source IDs. Activation rejects empty
outlines, missing coverage, references to absent source revisions, unsupported
supplemental sources, and any prerequisite that is neither earlier in the
outline nor in explicitly recorded prior knowledge. This also rejects cycles
and self-dependencies. Drafts may retain missing coverage and unresolved
prerequisites for correction; malformed structure and duplicate IDs fail early.
External source authenticity and goal/prerequisite closure belong to phase 2,
not to this structural validator.

```ts
interface LegacyCourseRow {
  id: string;
  textbook_id: string;
  goal: string;
  goal_prompt: string;
  mode: number;
  outline_json: string;
}
interface LegacyPoint {
  id: string;
  title: string;
  chapter_ref: string;
}
function importLegacyCourse(row: LegacyCourseRow, points: LegacyPoint[]): {
  draft: CourseVersion;
  mode: LearningMode;
  masteryOrigin: 'legacy';
  warnings: string[];
};
interface StoredQuestion {
  questionId: string;
  courseId: string;
  courseVersionId: string;
  type: 'choice' | 'fill' | 'code';
  stem: string;
  options?: string[];
  difficulty: Difficulty;
  answer: string;
  referenceSolution?: string;
  hiddenTests?: unknown[];
}
type QuestionView = Pick<StoredQuestion,
  'questionId' | 'courseId' | 'courseVersionId' | 'type'
  | 'stem' | 'options' | 'difficulty'>;
function toQuestionView(question: StoredQuestion): QuestionView;
```

Question projection explicitly enumerates allowed fields; no rest/spread from
the stored question. It must also detach options. It does not validate/render
rich content or provide a question publishing service.
Legacy import reads the current `outline_json.nodes` and optional `quizConfig`
fields perKnowledgePoint/perChapter/finalCount/passThreshold. Missing counts
use defaults, a positive passThreshold maps to mastery with a conversion
warning (no claim that numeric thresholds are equivalent). Reject malformed
JSON, duplicate/unknown points or invalid settings. Group contiguous points
by chapter without changing order. A chapter repeated after another chapter
must have a distinct module ID. Imported points have missing coverage and no
source IDs, so the draft requires source/prerequisite review before activation.
Old mastery scores are not imported as verified state.

- [ ] **Step 1: Write failing tests and a shared two-point fixture.**

Fixture `courseInput()` returns a fresh input with textbook book-a, goal
"Python basics", source book-a/rev-1, module basics and points variables then
loops; loops depends on variables, both reference book-a. Fixture
`activeVersion()` calls create then activate.

```ts
expect(parseAssessment({})).toEqual({
  pointQuestionCount: 3, chapterQuestionCount: 10,
  finalQuestionCount: 10, difficulty: 'easy',
  progressionPolicy: 'completed',
});
expect(() => parseAssessment({ pointQuestionCount: 51 }))
  .toThrow(LearningError);
const first = createCourseVersion(courseInput());
const next = reviseCourseVersion(first, { ...courseInput(), goal: 'Algorithms' });
expect(next.courseId).toBe(first.courseId);
expect(next.courseVersionId).not.toBe(first.courseVersionId);
expect(first.goal).toBe('Python basics');
expect(next.status).toBe('draft');
```

Also test every mode round trip, invalid modes, zero anchor index round trip,
counts/enum validation, duplicate IDs, unmet prerequisites, cyclic/reversed
order, prior-knowledge exemption, source gaps, missing source revision,
supplement settings, nested mutation isolation, legacy defaults/warnings and
deep student DTO leakage using sentinel answer/reference/hidden-test values.

- [ ] **Step 2: Run `pnpm test tests/verified-learning/contracts.test.ts tests/verified-learning/course-version.test.ts`; confirm missing behavior.**
- [ ] **Step 3: Implement the interfaces with existing Zod and standard library.**

```ts
const questionCount = z.number().int().min(1).max(50);
const id = z.string().refine(value => value.trim().length > 0);
// Keep validation failures within the domain's error vocabulary.
const parsed = schema.safeParse(input);
if (!parsed.success) throw new LearningError('INVALID_INPUT', 'Invalid input');
```

Use `randomUUID()` for new IDs and `new Date().toISOString()` for timestamps.
For activation, walk the stored order with a Set initialized from prior
knowledge, check every prerequisite before adding the point, and verify
source IDs against the snapshot's source revision set.

- [ ] **Step 4: Run focused tests and `pnpm test`; verify no old caller changes.**
- [ ] **Step 5: Commit only this task's files as `feat: add verified learning contracts and course versions`.**

## Task 2: Pure Three-Mode Session State

**Files:**
- Create `src/lib/verified-learning/session.ts`
- Create `tests/verified-learning/session.test.ts`
- Consume Task 1 fixtures, contracts and version constructors without changing their semantics.

**Interfaces:**

```ts
type ActivityKind = 'lesson' | 'point_quiz' | 'chapter_quiz'
  | 'final_quiz' | 'diagnostic';
interface Activity {
  activityId: string;
  kind: ActivityKind;
  moduleId: string | null;
  knowledgePointIds: string[];
  questionCount: number;
}
interface StudySession {
  sessionId: string;
  courseId: string;
  courseVersionId: string;
  mode: LearningMode;
  revision: number;
  currentActivity: Activity | null;
  completedActivityIds: string[];
  abandonedActivityIds: string[];
  displayedKnowledgePointIds: string[];
  practiceCompletedKnowledgePointIds: string[];
  declaredKnowledgePointIds: string[];
  diagnosedKnowledgePointIds: string[];
}
type NextStep =
  | { kind: 'activity'; activity: Activity }
  | { kind: 'blocked'; reason: 'PRIOR_KNOWLEDGE_REQUIRED' | 'MASTERY_REQUIRED';
      knowledgePointIds: string[] }
  | { kind: 'done' };
type SessionCommand =
  | { type: 'start_activity'; activityId: string }
  | { type: 'complete_activity'; activityId: string;
      answeredQuestionIds?: string[]; diagnosedKnowledgePointIds?: string[] }
  | { type: 'abandon_activity'; activityId: string }
  | { type: 'change_mode'; mode: LearningMode }
  | { type: 'declare_prior_knowledge'; knowledgePointIds: string[] }
  | { type: 'record_infrastructure_error'; activityId: string };
function createStudySession(version: CourseVersion, mode: unknown): StudySession;
function allowedKnowledgePointIds(session: StudySession): string[];
function nextActivity(version: CourseVersion, session: StudySession,
  verifiedKnowledgePointIds?: readonly string[]): NextStep;
function transitionSession(version: CourseVersion, session: StudySession,
  expectedRevision: number, command: unknown,
  verifiedKnowledgePointIds?: readonly string[]): StudySession;
```

The optional verified IDs are a read-only trusted evidence projection, never
derived from self-declaration/completion. The initial store in Task 3 passes
none, so mastery policy explicitly blocks until the later evidence service
exists. This limit must be stated in docs, not bypassed.

Stable activity IDs use a serialized tuple of version ID, activity kind and
scope ID, not ambiguous colon concatenation. A point quiz has the same ID in
practice and drill. All functions are pure with detached return values;
computing nextActivity never writes progress. Create a session only for an
active version. Existing sessions may continue against their matching
archived version; foreign version/course/session state is rejected.

Schedules:
- theory: each module's point lessons, then its chapter quiz.
- practice: lesson then point quiz for each point, then chapter quiz.
- drill: only point quizzes, then final quiz, never a lesson/chapter quiz.
- Counts come from module overrides for point/chapter quizzes and course
  settings for the final quiz. Lesson count is zero.
- With drill prerequisites/target knowledge absent from the allowed union,
  offer a diagnostic for missing in-outline knowledge before a point quiz.
  Diagnostic IDs depend on the missing set. Record diagnosis separately;
  only explicitly passed IDs become diagnosed. A completed unsuccessful
  diagnostic returns PRIOR_KNOWLEDGE_REQUIRED rather than inserting theory
  or silently treating the learner as ready.
- For a chapter/final quiz, the allowed union must cover its knowledge scope.
- Under mastery policy, a completed point quiz without a verified evidence
  projection returns MASTERY_REQUIRED; theory never converts reading into
  mastery, and chapter/final completion under mastery must also meet the
  evidence gate for their scope.

The allowed union contains displayed, declared and diagnosed IDs only.
Available/unlocked points do not join it. Completing a lesson adds displayed
knowledge; completing a point quiz adds practiceCompleted, not mastery.
Completing a quiz requires at least questionCount distinct nonblank question
IDs (the future trusted assessment service supplies validated results).
Diagnostic question count equals its number of targeted points; it is not a
normal learned-content quiz and is limited to 50 points per activity.
For very large missing sets, diagnose the first 50 in stable outline order,
then continue to the next missing batch.

Mode switches retain version, all histories and prior knowledge. Reject a
switch while any activity is in progress; users finish or explicitly abandon
first. Abandonment is recorded, never counted complete; future schedules may
offer it again. Only the next permitted activity can start; a completion must
match the running activity. Infrastructure error leaves activity/progress
unchanged (apart from the accepted event's new revision). Invalid input or a
stale expectedRevision throws without mutation. Every accepted command
increments revision once. Unknown fields/types and noninteger revisions fail.

- [ ] **Step 1: Write failing schedule and transition tests.**

```ts
const version = activeVersion();
const session = createStudySession(version, 'practice');
const step = nextActivity(version, session);
expect(step.kind).toBe('activity');
expect(session.displayedKnowledgePointIds).toEqual([]);
expect(() => transitionSession(version, session, -1,
  { type: 'change_mode', mode: 'drill' })).toThrow(LearningError);
expect(allowedKnowledgePointIds(session)).toEqual([]);
```

Cover complete two-point schedules for all modes; module counts; unsupported
inputs; begin versus complete reading; start/finish mismatch; stale revision;
mid-activity switching; explicit abandonment; round-trip mode switches with
historical completion retained; deduplicated answered IDs; infrastructure
failure; declared versus diagnosed knowledge; unsuccessful/batched diagnosis;
mastery block/unblock with trusted evidence; course-version mismatch; mutation
isolation. Assert exact next activities and histories, not only no exceptions.

- [ ] **Step 2: Run `pnpm test tests/verified-learning/session.test.ts`; confirm missing behavior.**
- [ ] **Step 3: Implement schedule derivation and a validated command reducer.**

```ts
const activityId = JSON.stringify([version.courseVersionId, kind, scopeId]);
const allowed = new Set([
  ...session.displayedKnowledgePointIds,
  ...session.declaredKnowledgePointIds,
  ...session.diagnosedKnowledgePointIds,
]);
if (expectedRevision !== session.revision) {
  throw new LearningError('VERSION_CONFLICT', 'Session revision changed');
}
```

Use a straightforward switch for commands, not a new workflow framework.
Use Task 1 LearningError and parsing conventions; no DB/model imports.

- [ ] **Step 4: Run focused tests, `pnpm test` and `pnpm exec tsc --noEmit --incremental false`.**
- [ ] **Step 5: Commit as `feat: add versioned three-mode learning state`.**

## Task 3: Explicit Additive Persistence And Compatibility Gates

**Files:**
- Create `src/lib/verified-learning/store.ts`
- Create `tests/verified-learning/store.test.ts`
- Create `tests/verified-learning/compatibility.test.ts`
- Update branch contract, coordination document, and spec implementation status.

**Interfaces:**

```ts
function migrateVerifiedLearning(db: Database.Database): Promise<void>;
class VerifiedLearningStore {
  constructor(db: Database.Database);
  createVersion(scopeId: string, input: unknown): CourseVersion;
  reviseVersion(scopeId: string, versionId: string, input: unknown): CourseVersion;
  getVersion(scopeId: string, versionId: string): CourseVersion;
  activateVersion(scopeId: string, versionId: string): CourseVersion;
  createSession(scopeId: string, versionId: string, mode: unknown): StudySession;
  getSession(scopeId: string, sessionId: string): StudySession;
  dispatch(scopeId: string, sessionId: string, expectedRevision: number,
    idempotencyKey: string, command: unknown): StudySession;
}
```

No export uses getDb implicitly. Constructor does not migrate or copy data.
All scope and ID arguments are nonblank strings. Rows absent from the supplied
scope return NOT_FOUND, including cross-scope IDs, to avoid leaking existence.
Only server-side authenticated adapters may choose scopeId. No authentication
HTTP layer is claimed by having a scope parameter.

Tables:

```sql
CREATE TABLE vl_schema_migrations (
  version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
);
CREATE TABLE vl_course_versions (
  scope_id TEXT NOT NULL, version_id TEXT NOT NULL,
  course_id TEXT NOT NULL, status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (scope_id, version_id)
);
CREATE TABLE vl_study_sessions (
  scope_id TEXT NOT NULL, session_id TEXT NOT NULL,
  version_id TEXT NOT NULL, revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  PRIMARY KEY (scope_id, session_id)
);
CREATE TABLE vl_learning_events (
  scope_id TEXT NOT NULL, session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, revision INTEGER NOT NULL,
  request_json TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, session_id, idempotency_key),
  UNIQUE (scope_id, session_id, revision)
);
```

Use check constraints and appropriate references/indexes where they actually
enforce these invariants; do not change existing mainline PRAGMAs/schema.
Migration version 1 is idempotent and transactional. Inspect current version
before backup; if a file database needs migration, await `db.backup` to a new
sibling filename containing a random UUID, then run DDL and migration record
in one immediate transaction. Memory DB needs no file backup. Backup failure
leaves schema untouched; DDL failure leaves neither partial tables nor a
completed migration row. Refuse an unknown newer migration version rather
than assuming compatibility. No CLI/default database migration in this phase.

Store snapshots are append-only: revision creates a new draft/version row.
Activation updates only statuses, archives any formerly active version of the
same scoped course, and leaves snapshots/history intact. Existing sessions
retain their original version; no silent upgrade. Duplicate activation is
idempotent; archived versions are not reactivated by accident.

`dispatch` uses one immediate transaction: scope lookup; exact idempotent
retry detection; revision compare; transition; conditional UPDATE matching
revision; event insert with original request and resulting state. On event
failure, session UPDATE rolls back. An exact retry returns its original
result even after newer events; key reuse with a different command/revision
throws VERSION_CONFLICT. Use deterministic JSON command parsing/serialization
or equivalent structural equality so object property order is not meaningful.
Increment exactly once; wrong scope, rejected commands and stale updates
persist neither state nor event. Idempotency applies per session, never globally.

- [ ] **Step 1: Write failing in-memory and temporary file tests.**

```ts
const db = new Database(':memory:');
db.exec(SCHEMA_SQL);
await migrateVerifiedLearning(db);
await migrateVerifiedLearning(db);
const store = new VerifiedLearningStore(db);
const draft = store.createVersion('learner-a', courseInput());
store.activateVersion('learner-a', draft.courseVersionId);
const session = store.createSession('learner-a', draft.courseVersionId, 'theory');
const request = { type: 'change_mode', mode: 'practice' };
const changed = store.dispatch('learner-a', session.sessionId, 0, 'request-1', request);
expect(store.dispatch('learner-a', session.sessionId, 0, 'request-1', request))
  .toEqual(changed);
expect(() => store.getSession('learner-b', session.sessionId))
  .toThrow(LearningError);
```

Test all 11 old tables remain with unchanged old columns and existing rows.
Insert/read a linked textbook/course/question/attempt/note chain after
migration. Include a real temp-file backup and close/reopen persistence test;
two connections to the same test DB must reject the second stale update.
Use a SQLite trigger that aborts event insertion to prove transaction rollback.
Also cover migration rollback, backup failure, newer schema refusal,
cross-scope/course/version isolation, key collision versus exact retry,
property-order-insensitive retry, statuses/history and draft-session rejection.
Temp directories are test-owned and removed only after closing handles.

Compatibility test directly calls existing textbook POST with only
parse/embed/chunk-store boundary mocks as necessary. Lock exact success 200
keys, missing-file 400, invalid-format 400, MissingApiKeyError 400, parse
failure 422, and `{ error: string }` shapes. Use a test-owned upload root via
a scoped cwd mock; never remove workspace data. No new wrapper over old API.

- [ ] **Step 2: Run new tests; confirm failures before implementation.**
- [ ] **Step 3: Implement explicit migration and scoped store.**

```ts
const apply = db.transaction(() => {
  const result = transitionSession(version, current, expectedRevision, command);
  const update = db.prepare(
    'UPDATE vl_study_sessions SET revision = ?, state_json = ? ' +
    'WHERE scope_id = ? AND session_id = ? AND revision = ?',
  ).run(result.revision, JSON.stringify(result), scopeId, sessionId, expectedRevision);
  if (update.changes !== 1) {
    throw new LearningError('VERSION_CONFLICT', 'Session revision changed');
  }
  // Insert the corresponding event within this same transaction.
  return result;
});
```

Keep SQL/schema near this store instead of introducing a general repository
framework. Use shared domain constructors/reducer rather than duplicating rules.

- [ ] **Step 4: Run focused tests, all tests, typecheck, production build, and `git diff --check`.**
- [ ] **Step 5: Update docs with actual exports, baseline, limitations, test evidence and next phase; commit as `feat: persist isolated verified learning sessions`.**

## Completion Checks

- [ ] Task 1 review: contract and version behavior verified.
- [ ] Task 2 review: all three mode paths and transition edge cases verified.
- [ ] Task 3 review: persistence, scope, retry, backup and legacy compatibility verified.
- [ ] Whole-slice review: compare only this slice against the approved spec, not unrelated inherited mainline behavior.
- [ ] Record exact test/typecheck/build results. Keep branch/worktree; no mainline merge, push, deployment or background server.

## Deferred To Following Slices

Phase 2 adds actual source/prerequisite verification and course confirmation UI.
Phase 3 adds validated questions, isolated JudgePort, evidence and review; only
then can the store resolve mastery gates. Later phases add routes/authentication,
jobs, rich lessons, connections, reviewer sessions, and model evaluation.
The first slice does not claim any of these are already integrated.
