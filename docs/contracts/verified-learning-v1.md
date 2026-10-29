# Verified Learning 接口契约 v1

- 核验日期：2026-10-20
- 状态：第一切片已实现本地领域核心、显式存储和兼容测试；其余章节中的 HTTP、来源、证据约定仍为设计目标，未宣称两条开发线共同采纳。
- 对齐提交：`cd591dc`（已审阅的主线快照；不包含主线未提交改动）
- 主线：`feat/mvp`
- 增强分支：`feat/verified-learning`
- 适用原则：公共接口不破坏、新能力增量提供、调用方通过适配器选择实现。

## 1. 已存在的主线接口

以下取自已提交代码，而非旧实现计划。它们是本分支的兼容基线。

| 位置 | 当前接口 | 保持项 |
|---|---|---|
| src/lib/db/index.ts | getDb(dbPath?: string): Database.Database | 显式参数、DB_PATH、默认 data/app.db 的优先顺序 |
| src/lib/db/index.ts | resetDbForTest(): void | 测试隔离入口 |
| src/lib/textbook/parse.ts | parseTextbook(filePath: string): Promise<ChapterTree> | 参数与结果结构 |
| src/lib/textbook/chunk.ts | chunkChapterTree(tree: ChapterTree): Chunk[] | 原有导出与锚点形态 |
| src/lib/rag/store.ts | upsertChunks(db, textbookId, chunks, embeddings): void | 数据库为首参 |
| src/lib/rag/store.ts | searchChunks(db, textbookId, queryEmbedding, k): ScoredChunk[] | 参数顺序与 distance 字段 |
| src/lib/llm/provider.ts | getModel(): LanguageModel | 同步模型工厂接口 |
| src/lib/llm/provider.ts | getEmbeddingModel(): EmbeddingModel | 同步模型工厂接口 |
| src/lib/llm/prompts.ts | loadSubjectPrompt(subjectType: string): string | 学科提示词入口 |
| src/app/api/textbooks/route.ts | POST /api/textbooks | multipart 的 file 字段及现有响应 |

### 教材上传响应

成功为 HTTP 200：

```json
{
  "textbookId": "server-generated-id",
  "chapterCount": 2
}
```

错误保持 `{ "error": "message" }`。
缺少文件、不支持格式和缺少模型配置返回 400；解析/处理失败返回 422。
增强接口可以采用新的任务响应，但不把旧接口直接改为 202。
部署认证属于调用前提：已认证请求保留上述契约，未认证或越权请求可由
统一访问边界返回 401/403；不通过保留旧行为来豁免公开的上传接口。

### 教材结构

```ts
type BookFormat = 'txt' | 'md' | 'epub' | 'pdf' | 'docx' | 'mobi' | 'azw3';

interface Paragraph {
  text: string;
  images?: string[];
  anchor: { chapterId: string; index: number };
}

interface Chapter {
  id: string;
  title: string;
  level: number;
  paragraphs: Paragraph[];
}

interface ChapterTree {
  title: string;
  format: BookFormat;
  chapters: Chapter[];
}
```

上面是契约记录，不是另建一份可运行类型定义。
实现时从现有模块导入类型，避免类型漂移。

## 2. 计划与实现的边界

在 `cd591dc` 中，主线已经导出 `composeCourse(input)`、
`generateQuestions(input)`、`judgeAnswer(questionId, userAnswer)`、
`nextStep(courseId)` 和 `switchMode(courseId, mode)`。
这些仍属于 `src/lib/agent/` 的旧引擎；本切片未替换或接管这些实现，
也未将旧评分结果转成增强引擎的掌握证据。后续接入先核对实际 DTO 和语义。

### 第一切片实际导出

实现位于 `src/lib/verified-learning/`，无导入即迁移或默认数据库访问：

| 文件 | 实际导出 |
|---|---|
| contracts.ts | `LearningError`、`parseAssessment`、`parseCourseInput`、`toQuestionView`，以及课程/题目/设置类型 |
| course-version.ts | `createCourseVersion`、`reviseCourseVersion`、`activateCourseVersion` |
| legacy.ts | `fromLegacyMode`、`toLegacyMode`、`toSourceAnchor`、`toLegacyAnchor`、`importLegacyCourse` |
| session.ts | `createStudySession`、`allowedKnowledgePointIds`、`nextActivity`、`transitionSession`，以及 `Activity`、`StudySession`、`SessionCommand`、`NextStep` |
| store.ts | `migrateVerifiedLearning(db): Promise<void>`、`VerifiedLearningStore` |

`VerifiedLearningStore` 接收显式 `Database.Database`，构造函数不迁移。
方法为 `createVersion(scopeId, input)`、`reviseVersion(scopeId, versionId, input)`、
`getVersion(scopeId, versionId)`、`activateVersion(scopeId, versionId)`、
`createSession(scopeId, versionId, mode)`、`getSession(scopeId, sessionId)`、
`dispatch(scopeId, sessionId, expectedRevision, idempotencyKey, command)`。
创建/修改课程返回草稿 `CourseVersion`，会话方法返回 `StudySession`。
实际会话包含 `currentActivity: Activity | null`、完成/放弃活动及知识范围数组；
第 4 节的 `StudySessionView` 是未来 HTTP 投影，不是此内部类型。

所有 scope/ID 必须为非空白字符串；缺失和跨 scope 记录均报 `NOT_FOUND`。
scope 是存储隔离键，不是认证；只有未来服务端认证适配器可选择它。
实际 `LearningError.code` 为 `INVALID_INPUT`、`NOT_FOUND`、
`VERSION_CONFLICT`、`VALIDATION_FAILED`、`ACTIVITY_IN_PROGRESS`。
下文其余 HTTP 错误码尚未实现。

课程激活只验证已提交快照的结构、来源 ID 覆盖和先修顺序/环，
不验证资料内容、引用真实性或教学质量。完成/诊断命令属于受信任后台事实，
不是公开请求 DTO；题目归属、答案正确性和证据有效性由后续测评服务验证。
当前存储不接收掌握证据；`mastery` 门槛保持阻塞，不由阅读或完成活动制造掌握。

以下现状需要用测试覆盖，但本轮不修改主线代码：

1. chunk ID 按单本教材从 chunk1 重新编号；多教材持久化前需要命名空间适配。
2. upsertChunks 当前使用 INSERT，不把函数名解释成已具备重复导入幂等性。
3. 检索的教材过滤、k 近邻语义及范围隔离要使用多教材样例验证。
4. 上传中数据库写入与 embedding 失败回滚要单独验证。
5. 全局段落计数器不作为未来并发解析的正确性保证。

这些兼容补丁若必须修改共同文件，独立提交，避免夹带增强业务。

## 3. 新增能力的公共约定

以下为后续 HTTP 设计，当前没有增强路由或认证实现。规划前缀为 `/api/verified-learning/v1`。
正常 JSON 响应使用以下信封，主线旧接口不套用它：

```ts
interface ApiResult<T> {
  contractVersion: 1;
  requestId: string;
  data: T;
}

interface ApiFailure {
  contractVersion: 1;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

type LearningMode = 'theory' | 'practice' | 'drill';
type LegacyMode = 1 | 2 | 3;
type Difficulty = 'easy' | 'medium' | 'hard';

interface AssessmentSettings {
  pointQuestionCount: number;
  chapterQuestionCount: number;
  finalQuestionCount: number;
  difficulty: Difficulty;
  progressionPolicy: 'completed' | 'mastery';
}
```

模式映射固定为 1/theory、2/practice、3/drill。
题量默认值固定为 3、10、10。主线迁移时缺失设置使用这些默认值并记录迁移来源。
枚举不静默回退；不支持的值返回 INVALID_INPUT。
时间统一为 UTC ISO 8601，显示时才转换为用户时区。
ID 是不透明字符串；客户端不从 ID 推断目录、顺序或权限。

错误码至少包括 INVALID_INPUT、NOT_FOUND、UNAUTHENTICATED、FORBIDDEN、
VERSION_CONFLICT、BUDGET_EXCEEDED、SOURCE_UNAVAILABLE、VALIDATION_FAILED、
JUDGE_UNAVAILABLE、PROVIDER_ERROR 和 INTERNAL_ERROR。
响应不包含密钥、宿主路径、内部堆栈或题目标准答案。

## 4. 课程与学习会话

```ts
interface CourseRef {
  courseId: string;
  courseVersionId: string;
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
}

interface CourseView extends CourseRef {
  engine: 'verified-v1';
  textbookId: string;
  goal: string;
  teachingPrompt: string;
  status: 'draft' | 'active' | 'archived';
  assessment: AssessmentSettings;
  outline: CourseModuleView[];
}

interface StudySessionView extends CourseRef {
  sessionId: string;
  mode: LearningMode;
  revision: number;
  currentActivityId: string | null;
}

interface ChangeModeRequest {
  sessionId: string;
  expectedRevision: number;
  mode: LearningMode;
}
```

会话归属由服务端认证上下文决定，不接受客户端传入的任意 scopeId 作为授权。
更新会话使用 expectedRevision，防止多标签页覆盖状态。
旧 Course.mode 只作为兼容投影，不承载所有会话进度。

创建课程、激活版本和切换模式各为独立操作。
创建课程返回任务；课程未获用户确认前保持 draft。
增量路由规划为：

- POST `/courses`：创建课程生成任务，返回 HTTP 202。
- GET `/courses/{courseId}`：读取有权限的课程视图。
- POST `/courses/{courseId}/versions/{versionId}/activate`：确认一个版本。
- POST `/sessions`：基于明确课程版本建立学习会话。
- PATCH `/sessions/{sessionId}/mode`：带版本检查地切换模式。
- GET `/sessions/{sessionId}/next`：读取下一活动；读取不产生答题结果。
- POST `/sessions/{sessionId}/attempts`：提交作答；按幂等键防止重复记分。

上述是设计目标，不表示这些路由在当前分支已经可用。

### 长任务响应

```ts
interface JobView {
  jobId: string;
  status:
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  stage: string;
  eventCursor: number;
  result: CourseRef | null;
  error: ApiFailure['error'] | null;
}
```

创建课程返回 `ApiResult<JobView>`，调用方不依赖 HTTP 连接持续存在。
GET `/jobs/{jobId}` 返回最新任务视图；GET `/jobs/{jobId}/events`
使用 SSE 和递增事件 ID，重连支持 Last-Event-ID。
POST `/jobs/{jobId}/cancel` 请求取消；已经完成的任务不回滚已发布结果。
每个入口都验证会话归属，任务 ID 本身不授予访问权限。

## 5. 题目、证据和执行器边界

学生侧 QuestionView 只包含 questionId、课程版本、题型、题干内容块、
选项、难度和可展示提示，不包含标准答案、参考代码或隐藏测试输入。
题目生成结果与学生展示结果采用不同类型和序列化函数。

ValidationRecord 保存题目版本、允许知识范围、检查类型和结论；
LearningEvidence 保存作答、证据类型、提示使用、评分规则版本和时间。
二者不共用一个 correct 字段替代全部状态。

JudgePort 只接受后台发布的题目版本、学生代码和语言标识。
调用方不选择执行命令、容器镜像、网络权限或宿主路径。
服务结果区分 accepted、wrong_answer、runtime_error、time_limit、
memory_limit 和 infrastructure_error；最后一种不计为学生错误。

主线旧 questions/attempts 仍可读取；新语义放在增强表，不覆写旧答案记录。

## 6. 来源和检索连接器

```ts
interface SourceAnchor {
  chapterId?: string;
  paragraphIndex?: number;
  page?: number;
  heading?: string;
  blockId?: string;
}

interface EvidenceSnippet {
  sourceId: string;
  sourceRevision: string;
  text: string;
  anchor: SourceAnchor;
  contentHash: string;
  url?: string;
  fetchedAt?: string;
}

interface RetrievalRequest {
  query: string;
  sourceIds: string[];
  allowedKnowledgePointIds: string[];
  limit: number;
}
```

旧 anchor 的 index 显式映射到 paragraphIndex，不在原对象中改名。
请求中的 sourceIds 必须是会话已获授权来源的子集。
工具返回的路径和 sourceId 需要解析为受控来源，不直接参与文件读取。
同一 shape 同时用于教材、Obsidian 导入和外部检索，可信度与出处另存。

## 7. 增量迁移和数据切换

已实现的四张表为 `vl_schema_migrations`、`vl_course_versions`、
`vl_study_sessions`、`vl_learning_events`，迁移版本为 1。
`migrateVerifiedLearning(db)` 先检查迁移版本，拒绝未知较新版本；
需要迁移的文件库先等待 SQLite 在线备份完成，备份为原库同目录的
`<database>.vl-v1-<UUID>.bak`，然后在 immediate 事务中执行 DDL 和版本记录。
内存库不做文件备份；已是版本 1 时不重复备份或 DDL。
备份失败不执行 DDL；DDL 失败整笔回滚。备份保留供人工恢复，本切片无自动恢复 CLI。
不修改主线 PRAGMA；复合外键由启用 `foreign_keys` 的连接执行，
store 本身始终通过 scoped lookup 和事务维护引用范围。

课程修订追加新草稿；激活只改状态、归档同 scope 同课程的旧活动版本，
不改快照 JSON，不重新激活已归档版本。旧会话继续绑定原版本；
新会话只接受活动版本。事件包含请求、结果、递增 revision 和 UTC 时间。
dispatch 在同一 immediate 事务中检查 scope、历史幂等请求、revision，
调用 reducer，执行带 revision 条件的 UPDATE，并插入事件；任一步失败回滚。
幂等键按 scope/session 隔离；属性顺序不同但内容相同的 JSON 请求视为同一请求，
同键变更 command 或 expectedRevision 报 `VERSION_CONFLICT`。
精确重试返回原结果，即使会话已继续推进。命令只接受 JSON 值，不接受 undefined/函数/循环引用。

增强表使用 vl_ 前缀、事务性迁移和独立版本记录。
主线原 schema 不删除、不改列名、不自动复制生产数据。
仅把旧记录导入为新课程草稿；缺少证据的旧掌握分数标记为 legacy，
不伪造为已验证掌握。

从增强引擎导回旧引擎时，先检查字段与内容块是否可表示。
不支持的状态或交互显式报告，用户选择导出阅读副本或继续用增强引擎；
不静默丢弃验证信息并声称完全可逆。
切换应用实例与转换课程数据是两项不同操作。

## 8. 兼容门槛

第一切片已覆盖：

1. 老教材接口成功和错误响应。
2. 旧教材段落 anchor 与来源锚点的映射往返。
3. 三模式映射、默认题量与非法值处理。
4. 新表迁移后旧 11 张表结构与既有行不变，教材/课程/题目/作答/笔记链继续读写。
5. 题目学生 DTO 不泄露标准答案和隐藏用例。
6. 结构性来源 ID 覆盖、会话 scope/课程版本隔离与乐观并发检查。
7. 旧数据缺失增强字段时可解释的草稿导入状态，不伪造证据。

存储测试还覆盖真实临时文件备份/重开、备份失败、DDL 回滚、较新版本拒绝、
双连接陈旧更新、事件插入触发器失败回滚、历史精确重试、键冲突和归档版本保留。
教材兼容测试直接调用现有 POST，只替换解析/embedding/chunk-store 边界；
DB 和上传文件真实读写且限定测试临时目录。它锁定响应契约，
不宣称修复旧上传流程在 embedding 失败后留下教材行的既有行为。

后续第二阶段才接入语义来源/先修验证和课程确认 UI；
第三阶段增加题目验证、隔离 JudgePort、证据与复习。
HTTP 认证、jobs、富课件、连接器、评审体验和模型评测另行交付。

公共契约变化先修改本文和相应测试，再增加适配器。
破坏性变化使用 v2 路由或显式迁移，不在 v1 原地更改语义。
