# Verified Learning 接口契约 v1

- 日期：2026-10-19
- 状态：提议契约；已核对主线代码，尚未由两条开发线共同采纳。
- 对齐提交：`4949471`
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

旧计划提及的 composeCourse、generateQuestions、judgeAnswer、nextStep 等，
在对齐提交中尚无已提交实现；不把它们伪装为已经稳定的公共接口。
主线引入相关实现后，本分支先检查其实际 DTO，再增加适配器和契约测试。

以下现状需要用测试覆盖，但本轮不修改主线代码：

1. chunk ID 按单本教材从 chunk1 重新编号；多教材持久化前需要命名空间适配。
2. upsertChunks 当前使用 INSERT，不把函数名解释成已具备重复导入幂等性。
3. 检索的教材过滤、k 近邻语义及范围隔离要使用多教材样例验证。
4. 上传中数据库写入与 embedding 失败回滚要单独验证。
5. 全局段落计数器不作为未来并发解析的正确性保证。

这些兼容补丁若必须修改共同文件，独立提交，避免夹带增强业务。

## 3. 新增能力的公共约定

新增路由前缀为 `/api/verified-learning/v1`。
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

增强表使用 vl_ 前缀、事务性迁移和独立版本记录。
主线原 schema 不删除、不改列名、不自动复制生产数据。
仅把旧记录导入为新课程草稿；缺少证据的旧掌握分数标记为 legacy，
不伪造为已验证掌握。

从增强引擎导回旧引擎时，先检查字段与内容块是否可表示。
不支持的状态或交互显式报告，用户选择导出阅读副本或继续用增强引擎；
不静默丢弃验证信息并声称完全可逆。
切换应用实例与转换课程数据是两项不同操作。

## 8. 兼容门槛

第一阶段实现契约测试，至少锁定：

1. 老教材接口成功和错误响应。
2. ChapterTree 与 anchor 映射往返。
3. 三模式映射、默认题量与非法值处理。
4. 新表迁移后旧 11 张表仍可按旧字段读写。
5. 题目学生 DTO 不泄露标准答案和隐藏用例。
6. 来源范围、会话归属与乐观并发检查。
7. 旧数据缺失增强字段时可解释的导入状态。

公共契约变化先修改本文和相应测试，再增加适配器。
破坏性变化使用 v2 路由或显式迁移，不在 v1 原地更改语义。
