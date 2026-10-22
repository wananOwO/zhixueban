# 可验证编课与课程确认：第二阶段实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务执行；有可用子代理时可选择 `superpowers:subagent-driven-development`。勾选项用于记录实际完成情况，不以编写代码代替验证。

**Goal：** 从本地教材、学习目标和已有基础生成带真实来源、先修闭包与缺口说明的课程草稿，允许人工调整并显式确认新课程版本。

**Architecture：** 在第一阶段纯领域核心和 scoped store 之上增加来源快照、确定性编课校验与课程设计服务；模型只提出候选，不拥有文件、数据库或工具执行权限。持久化编课任务支撑刷新恢复；本机口令会话保护新增 API，独立页面不接管旧学习引擎。

**Tech Stack：** 当前分支的 TypeScript、Zod 4、better-sqlite3、AI SDK 7、Next.js 16.4.2、React、Vitest。保持生产依赖版本；仅拟新增 `tsx`、`@testing-library/react`、`jsdom` 三项开发依赖，分别用于显式迁移命令和交互测试。

**Spec：** `docs/superpowers/specs/2026-10-19-verified-learning-design.md` 第 3、4、8、9、11—14 节；兼容契约 `docs/contracts/verified-learning-v1.md`。不声称本阶段实现总设计的所有能力。

**状态：范围重议，暂停执行，未开始业务实现。** 用户补充教材库、学习继续/回看、建课草稿和重复创建修复，随后确认归档/受保护删除与本轮编程自动判题。融合设计 `docs/superpowers/specs/2026-10-20-complete-learning-experience-design.md` 已获用户确认并增加 C；新总入口为 `docs/superpowers/plans/2026-10-21-complete-learning-experience.md`。本文件仅保留编课技术参考，不能直接执行；其中工作台排除项与 4—7 小时估计已不适用于融合后的本轮。此前本机专用、暂不合并主线约束保留。

## Global Constraints

- 工作目录只使用 `E:/code/程序设计比赛-verified-learning`，分支 `feat/verified-learning`；起始 HEAD `7dc9145`，兼容基线 `cd591dc`。原目录当前是 `main@ac6f0a9`，存在未提交修改，不切换、不复制、不合并。
- 新业务在 `src/lib/verified-learning/`；UI 在 `src/components/verified-learning/`、`src/app/verified-learning/`；API 在 `src/app/api/verified-learning/v1/`；测试在 `tests/verified-learning/`。
- 原 11 张表、旧教材 POST 响应、旧 provider/课程/学习接口不改。共享配置仅允许为本阶段测试与显式初始化增加开发工具，不升级已有依赖。
- 模式 1/theory、2/practice、3/drill 不变；题量默认 3、10、10，正整数且不超过 50；难度 easy/medium/hard；默认 progressionPolicy=completed。时间 UTC ISO 8601，ID 不透明。
- 不调用旧 `generateKnowledgeGraph`、`composeCourse`、出题器或执行器；它们会写旧表或没有增强来源校验。只复用 `ChapterTree`、旧教材只读数据和 `getModel()`。
- 新迁移仍须显式、先备份、再事务；导入、构造函数、页面、API、应用启动都不迁移。真实数据迁移由用户手动执行，本轮测试仅使用测试拥有的库。
- 只支持单一教材所有者的本地实例：`http://127.0.0.1:3101`，服务必须绑定 `127.0.0.1`。旧 API 尚无统一认证，新增口令不使整个应用适合公网部署。
- scope 由服务端口令会话解析，客户端字段不能指定身份；所有来源、课程、任务查询均带 scope。跨 scope 与不存在统一 NOT_FOUND。
- 每项先观察测试失败，再最小实现、定向及全量测试。实现后执行 code-review-expert；没有独立审查工具则明确标为作者自审。
- 不自动暂存、提交、合并、推送、部署、启动长期服务器或调用收费模型；提交范围由用户管理。计划中的提交检查点可先记录为“实现已验证，待用户提交”。

## 本阶段交付与非目标

交付路径：登录本机入口 → 选择教材和章节 → 设置目标/基础/题量 → 生成任务 → 检查来源/先修/缺口 → 调整草稿 → 确认版本。

不交付：增强学习工作台、题目验证/JudgePort、掌握证据、复习、媒体/MCP、外部网页抓取、统一公网账号、评审会话、通用后台队列和模型效果评测。

确认后显示“课程版本已保存，增强学习工作台尚未接入”，不跳转旧 `/learn` 冒充闭环完成。补充资料只选择本机已经导入的教材；不自动获取网络资料。

### 明确的产品与工程取舍

| 选择 | 行为及边界 |
|---|---|
| 引用真实性 | 服务端核对版本、实际段落锚点、摘录和哈希；只证明摘录来自该来源，不证明教材或教学判断一定正确 |
| 语义/先修确认 | 模型建议由用户在确认页检查；先修闭包与顺序由程序检查。确认记录标为用户确认，不标为独立模型审查或掌握证据 |
| 教材范围 | 每次最多 4 个来源、80,000 个选中正文字符、200 个候选知识点；超过限制明确要求缩小章节范围，不静默截断，不把未分析章节说成没有知识 |
| 调用预算 | 每任务最多 3 次模型调用，单次超时 60 秒、最多 8,192 输出 token，SDK maxRetries=0；手动恢复不清零次数，不承诺第三方计费幂等 |
| 页面实现 | 沿用现有表单/主题，不做全站重设计；桌面与窄屏均使用可键盘操作的列表和上下移动按钮，不依赖拖拽 |

## Review Focus

1. 同一本书的重复段落序号、相同内容的不同书、更新或撤销的来源不能互相充当引用；任务 1/3 覆盖。
2. 排除游戏项目不能顺带丢掉算法需要的函数；模型漏报先修、用户硬排除必需点与已有基础须有可解释状态；任务 2 覆盖。
3. 两个标签页同时修订/激活、任务重复提交、旧 worker 延迟回写，不能覆盖新版本或重复创建课程；任务 3/4 覆盖。
4. 默认关闭、伪造 Host/Origin/scope、注销后重用 cookie、跨 scope ID 与错误详情，不得泄露教材、密钥或宿主路径；任务 5 覆盖。
5. 模型/教材里的脚本和权限指令、生成中刷新、网络失败以及未解决缺口，不能绕过验证或制造“已确认”状态；任务 4/6 覆盖。

## 文件职责与依赖

| 任务 | 文件职责 | 前置 |
|---|---|---|
| 1 | `sources.ts`、`curriculum-contracts.ts`：来源与新增输入/输出类型 | 第一阶段 |
| 2 | `curriculum.ts`：候选图、先修闭包、排序、覆盖与调整验证 | 1 |
| 3 | `store.ts` 增量迁移；`curriculum-store.ts`、`curriculum-service.ts`：来源/设计持久化与确认事务 | 1、2 |
| 4 | `curriculum-model.ts`、`curriculum-jobs.ts`：受限模型适配、任务状态与恢复 | 3 |
| 5 | `local-access.ts`、`server.ts`、`http.ts`、新路由、初始化脚本：本机身份与 HTTP 边界 | 3、4 |
| 6 | 新页面/组件、浏览器与交互验收、契约更新 | 5 |

任务 1—3 是领域核心；任务 4—6 是可使用的本机接入。任务逐个验收，不并行改共享接口。

## 任务 1：真实教材快照与引用检查

**Files：** 新增 `src/lib/verified-learning/sources.ts`、`curriculum-contracts.ts`；新增 `tests/verified-learning/sources.test.ts`、`curriculum-contracts.test.ts`、`curriculum-fixtures.ts`。

**Interfaces：** 从旧教材模块导入 `ChapterTree`，从第一阶段导入 `CourseInput`、`AssessmentSettings`、`LearningError`，不复制它们。

```ts
interface SourceRef { sourceId: string; sourceRevision: string }
interface SourceSnapshot extends SourceRef {
  title: string; format: ChapterTree['format'];
  chapters: { chapterId: string; title: string; paragraphs: {
    paragraphIndex: number; text: string; contentHash: string;
  }[] }[];
}
interface CitationInput extends SourceRef {
  chapterId: string; paragraphIndex: number; quote: string;
}
type CitationCheck =
  | { ok: true; citation: CitationInput & { contentHash: string }; paragraphText: string }
  | { ok: false; reason: 'SOURCE_MISSING' | 'REVISION_MISMATCH' | 'ANCHOR_MISSING' | 'QUOTE_MISMATCH' };
function createSourceSnapshot(sourceId: string, tree: ChapterTree): SourceSnapshot;
function checkCitation(sources: readonly SourceSnapshot[], citation: CitationInput): CitationCheck;
interface LearningAgreement {
  textbookId: string; goal: string; teachingPrompt: string; priorKnowledgeText: string;
  includedTopics: string[]; excludedTopics: string[];
  allowSupplementalSources: boolean; assessment: AssessmentSettings;
}
interface SourceSelection extends SourceRef { chapterIds: string[] }
interface CandidatePoint {
  id: string; title: string; prerequisiteIds: string[]; relatedIds: string[];
  citations: CitationInput[];
}
interface CurriculumProposal {
  points: CandidatePoint[]; targetIds: string[]; declaredIds: string[];
}
interface DesignChoices {
  targetIds: string[]; excludedIds: string[]; declaredIds: string[];
  order: string[] | null;
  prerequisiteEdits: { pointId: string; prerequisiteIds: string[]; reason: string }[];
  supplementalSourceIds: string[];
}
interface ComposeRequest {
  agreement: LearningAgreement; sources: SourceSelection[]; baseVersionId?: string;
}
function parseComposeRequest(input: unknown): ComposeRequest;
function parseCurriculumProposal(input: unknown): CurriculumProposal;
function parseDesignChoices(input: unknown): DesignChoices;
```

SourceRef/Citation/Agreement/Proposal/Choices/ComposeRequest 类型由 curriculum-contracts.ts 持有，来源函数由 sources.ts 持有。主教材/补充身份属于本次学习约定（sourceId 是否等于 textbookId），不写进快照身份，避免同一本书换角色时发生快照碰撞。

新增边界采用 strictObject，拒绝未知字段、空白/重复 ID、伪造 diagnosed 基础和客户端 contentHash。sources 的 sourceId 必须唯一、包含主教材，chapterIds 非空且不重复；只有开启补充资料才允许其他来源。`declaredIds` 只表示用户自报映射，UI 确认前标为模型建议。题量复用 parseAssessment。目标/提示词/已有基础文本分别上限 2,000/8,000/4,000 字符；每个知识点最多 8 个引用，每段摘录 1—2,000 字符；排除空白摘录。

快照仅保存文字与锚点，不带 file_path、图片文件路径或原始 HTML。正文 CRLF 统一为 LF，除此之外不折叠空格或 Unicode。contentHash 为 `sha256:` 加段落正文 UTF-8 SHA256；sourceRevision 对固定字段顺序的标题、格式、章节、段落正文/锚点整体序列化求同类哈希。校验 chapterId 与旧 anchor.chapterId 一致，index 是非负安全整数且全书唯一；按实际 index 查找，不能当作章节数组下标。返回值深拷贝。

- [ ] **Step 1：写失败测试。** 固定教材中第二章段落 index=7，模型引用它；并覆盖换书/换版本、重复 anchor、摘录伪造、空白字段、源对象后续变更、未知字段及 51 道题。

```ts
expect(checkCitation([snapshot], citationAtIndex7)).toMatchObject({ ok: true });
expect(checkCitation([snapshot], { ...citationAtIndex7, sourceId: 'another-book' }))
  .toEqual({ ok: false, reason: 'SOURCE_MISSING' });
expect(() => parseComposeRequest({ ...request, scopeId: 'victim' })).toThrow(LearningError);
```

- [ ] **Step 2：运行** `pnpm test tests/verified-learning/sources.test.ts tests/verified-learning/curriculum-contracts.test.ts`。Expected：新接口缺失或上述行为断言失败；不能把测试配置错误当作 RED。
- [ ] **Step 3：实现** 严格解析、来源规范化与可回查引用；fixture 包含变量、游戏章节里的函数、缺失算法、游戏项目和一本补充教材，不改旧解析器。
- [ ] **Step 4：验证** 同一命令、`pnpm test`、`pnpm exec tsc --noEmit --incremental false`。Expected：全部通过，208 个原测试仍保留。
- [ ] **Step 5：审查/记录** 来源隔离、hash 和路径泄露；记录验证证据。提交检查点：`✨ 新增可回查的教材快照与编课契约`，不自行暂存。

## 任务 2：先修闭包、可解释排课与人工调整

**Files：** 新增 `src/lib/verified-learning/curriculum.ts`、`tests/verified-learning/curriculum.test.ts`；扩展任务 1 fixture。

**Interfaces：** 消费任务 1 类型和第一阶段 `parseCourseInput`。

```ts
interface CurriculumIssue {
  code: 'SOURCE_GAP' | 'INVALID_CITATION' | 'UNKNOWN_KNOWLEDGE'
    | 'PREREQUISITE_CYCLE' | 'EXCLUDED_PREREQUISITE' | 'INVALID_ORDER'
    | 'SUPPLEMENT_NOT_APPROVED' | 'EMPTY_TARGET';
  knowledgePointIds: string[]; message: string;
}
interface CurriculumCompilation {
  input: CourseInput; issues: CurriculumIssue[];
  includedIds: string[]; skippedIds: string[];
  decisions: { knowledgePointId: string; action: 'keep' | 'skip' | 'reorder' | 'supplement'; reason: string }[];
}
function compileCurriculum(agreement: LearningAgreement, proposal: CurriculumProposal,
  sources: readonly SourceSnapshot[], choices: DesignChoices): CurriculumCompilation;
```

先检验完整候选图 ID/引用及环，再从目标遍历必要先修闭包；只有 prerequisiteIds 参与，relatedIds 仅展示。已明确接受的 declaredIds 可满足外部先修，不转为 diagnosed/verified；已声明不掩盖自依赖/环。默认 choices 使用模型 targetIds，declaredIds 默认为空，等待用户选择。

使用稳定 Kahn 拓扑序（候选原顺序破同级并列），禁止漏节点后当作成功随便追加。无法排序的节点可原序保留在**带阻塞 issue 的草稿**中供修复，不能通过确认。用户显式 order 必须恰好覆盖所选闭包、无重复且满足依赖；不静默覆盖人工顺序。

目标排除文本是建议筛选偏好，不是整章删除指令。显式 excludedIds 若是必需先修，保留缺口并阻塞确认；允许用户恢复、声明已有基础或在提供理由后修订关系。修改先修重新检查完整图，理由记录为人工调整而非机器证明。

coverage 根据实际有效引用计算，不能信任模型标签；主教材有效引用为 covered，仅补充资料有效引用为 supplemented，无证据为 missing。allowSupplementalSources=false 或未确认具体补充来源均阻塞。存在无效引用时不能用同点另一条有效引用掩盖 issue。知识点 role：目标为 target，闭包引入为 prerequisite；补充是来源属性，不覆盖知识点的教学角色。按排序后的相邻来源章节组装模块，moduleId 采用 JSON.stringify([sourceId, chapterId, 连续分组序号])，重复章节不碰撞；无来源用显式缺口分组。sourceRevisions 只包含实际引用的版本。未解决未知先修仍保留原 ID 和 issue，不能删边通过激活。

- [ ] **Step 1：写失败测试。** 变量 → 函数 → 算法，函数位于游戏章节；排除游戏项目仍保留函数；缺少算法来源阻塞，选定补充来源并确认后可通过；related 边不引入无关点。

```ts
expect(result.includedIds).toEqual(['variables', 'functions', 'algorithms']);
expect(result.skippedIds).toContain('game-project');
expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_GAP' }));
expect(() => activateCourseVersion(createCourseVersion(fixed.input))).not.toThrow();
```

再覆盖硬排除必需点、先修在 prior 中仍成环、未知节点、人工反序/重复/漏点、模块重复章节、不同目标产生不同选择、深拷贝以及关闭补充来源。

- [ ] **Step 2：运行** `pnpm test tests/verified-learning/curriculum.test.ts`。Expected：上述行为失败。
- [ ] **Step 3：实现** compileCurriculum；结构损坏抛 INVALID_INPUT，可供用户修复的课程问题放 issues，不把缺口悄悄删掉。
- [ ] **Step 4：验证** 定向测试、`pnpm test`、类型检查。Expected：全部通过；完成条件不是只有图能排序，还须准确断言最终节点和原因。
- [ ] **Step 5：审查/记录** 闭包、排除/基础交互及人工编辑；提交检查点：`✨ 新增先修闭包与课程草稿校验`。

## 任务 3：增量持久化与不可绕过的确认服务

**Files：** 修改 `src/lib/verified-learning/store.ts` 的迁移部分；新增 `curriculum-store.ts`、`curriculum-service.ts`；新增 `tests/verified-learning/curriculum-store.test.ts`、`curriculum-service.test.ts`；更新旧 `store.test.ts` 的“当前 schema 版本”断言，保留所有旧行为测试。

**Interfaces：** `migrateVerifiedLearning(db)` 最新版本变为 2；第一阶段 `VerifiedLearningStore` 方法语义不变。新增类型与导出在对应模块直接导出，不加 barrel。

```ts
interface DesignView {
  version: CourseVersion; latestVersionId: string;
  proposal: CurriculumProposal; choices: DesignChoices;
  compilation: CurriculumCompilation;
  citations: { knowledgePointId: string; input: CitationInput; check: CitationCheck }[];
  confirmedAt: string | null;
}
class CurriculumStore {
  constructor(db: Database.Database);
  putSource(scopeId: string, snapshot: SourceSnapshot): SourceSnapshot;
  getSource(scopeId: string, ref: SourceRef): SourceSnapshot;
  getDesign(scopeId: string, versionId: string): DesignView;
  listDesigns(scopeId: string): { courseId: string; versionId: string; title: string; status: string }[];
}
class CurriculumService {
  constructor(db: Database.Database);
  saveGenerated(scopeId: string, request: ComposeRequest, proposal: CurriculumProposal,
    jobId: string): DesignView;
  revise(scopeId: string, baseVersionId: string, choices: unknown, idempotencyKey: string): DesignView;
  activate(scopeId: string, versionId: string, confirmation: {
    expectedLatestVersionId: string; acceptSourceAndPrerequisiteReview: true;
  }): DesignView;
}
```

新增表（均有 scope 复合主键/引用、JSON/check 约束与必要索引）：

| 表 | 数据/不变量 |
|---|---|
| vl_source_revisions | scope、source_id、revision、snapshot_json、created_at、revoked_at；快照不可覆盖，相同 ID/revision 幂等 |
| vl_course_reviews | scope、version_id、job_id、agreement/proposal/choices/compilation JSON、confirmed_at；版本快照固定，确认时间一次性记录 |
| vl_design_heads | scope、course_id、head_version_id；修订/激活 CAS，不能“最后写入胜出” |
| vl_jobs / vl_job_events | scoped 任务、幂等键/请求、状态/阶段、预算/租约、结果和递增事件游标；任务 4 定义语义 |
| vl_web_sessions | token_hash 主键、scope、expires_at、配置指纹；任务 5 使用，不存口令或原始 token |

任务 3 同时定义任务 4/5 消费的最小表结构：`vl_jobs` 主键 `(scope_id,job_id)`、唯一 `(scope_id,idempotency_key)`，列为 request_json/status/stage/attempts/lease_token/lease_until/proposal_json/result_json/error_json/created_at/updated_at；`vl_job_events` 主键 `(scope_id,job_id,cursor)`，保存 stage/message/created_at，cursor 从 1 递增、与任务更新同一事务。租约/检查点/结果/错误可空，attempts 为 0—3 整数，状态限任务 4 枚举；结果 JSON 存 courseId/courseVersionId。`vl_web_sessions` 保存 token_hash/scope_id/expires_at/config_fingerprint，token_hash 为唯一键。这些表即使尚未接模型/路由也可直接用测试夹具验证；不要反向依赖任务 4 模块。

修订幂等在 `vl_course_reviews` 保存可空 `edit_key`、`edit_request_json`、`parent_version_id`，唯一索引 `(scope_id, parent_version_id, edit_key)`；同键相同请求返回原版本，不同内容报 VERSION_CONFLICT。新增表不改旧表列。

迁移检查最新版本，拒绝 >2；文件库升级前备份到 `<db>.vl-v2-<UUID>.bak`，在一个 immediate 事务依次应用缺失的 v1/v2 并写记录；内存库跳过文件备份。已有 v1 升级保留所有课程/会话/事件。备份失败零 DDL，v2 失败整笔回滚，再次执行不重复备份。第一阶段较新版本拒绝测试用 3，不能删除该安全测试。

saveGenerated 仅接受 scoped 已存在的 job，请求必须等于已存 job 请求；调用从任务内部完成，不公开给浏览器。创建新课或基于 baseVersionId 追加版本，保存设计/heads/任务结果须同一事务；baseVersionId 必须仍是该课程 head，旧任务迟到不允许覆盖新修订。来源按请求的 chapterIds 筛成模型/编课视图，保留原来源版本哈希，不重算成新的全书版本；引用超出选定章节明确拒绝，不能借同书未分析章节的内容通过检查。修订加载原候选、原任务的选定章节与 scoped 来源重新计算，不接受客户端 coverage/hash/status。

activate 在同一事务读取最新 head、全部来源及未撤销状态，重新执行 compileCurriculum 与第一阶段结构校验，issues 非空、非最新版本、缺少用户确认均拒绝。来源使用精确的不可变版本：导入新版不会自动撤销旧版，旧引用不能被新版文本替代；明确撤销的版本不得用于新确认。通过才调用旧 store.activateVersion，并记录确认和任务事件；历史版本/会话不变。已经激活的同版本精确重试幂等，但过时或已归档版本不重新激活。第一阶段 store 仍是受信任底层端口，新增 HTTP 不直接调用它绕过检查。

- [ ] **Step 1：写失败测试。** 真实临时文件 v1→v2、旧 11 表及四张 v1 表历史保留、备份/DDL 失败/重入/>2 拒绝；跨 scope、重复保存、同键异内容、两连接修订冲突、事件失败全回滚。

```ts
expect(service.revise('a', baseId, edit, 'edit-1').version.courseVersionId)
  .toBe(service.revise('a', baseId, edit, 'edit-1').version.courseVersionId);
expect(() => service.activate('a', gapVersionId, confirmation)).toThrow(LearningError);
expect(store.getDesign('a', gapVersionId).version.status).toBe('draft');
```

追加来源撤销/版本变化、手工伪造覆盖字段、重复激活、旧版本学习会话仍有效等断言。

- [ ] **Step 2：运行** `pnpm test tests/verified-learning/curriculum-store.test.ts tests/verified-learning/curriculum-service.test.ts`。Expected：新行为失败。
- [ ] **Step 3：实现** 显式 v2 迁移、来源/设计存储与事务服务；测试只创建/清理测试临时目录，先关句柄再清理。
- [ ] **Step 4：验证** 定向测试、全量测试、类型检查及 `git diff --check`。Expected：全部通过，旧教材兼容测试保持原状态码和字段。
- [ ] **Step 5：审查/记录** 事务与确认绕过风险；提交检查点：`✨ 持久化来源与可确认的课程版本`。

## 任务 4：受限模型编课与可恢复任务

**Files：** 新增 `src/lib/verified-learning/curriculum-model.ts`、`curriculum-jobs.ts`；新增 `tests/verified-learning/curriculum-model.test.ts`、`curriculum-jobs.test.ts`。

**Interfaces：** 使用任务 1—3 的服务；下列 JobView 与契约 v1 既有字段一致，可增加明确的恢复/尝试摘要但不返回原始模型响应。

```ts
interface ModelResult {
  proposal: CurriculumProposal; modelId: string; promptVersion: 'curriculum-v1';
  inputTokens: number | null; outputTokens: number | null;
}
interface CurriculumModelPort {
  propose(request: ComposeRequest, selectedSources: SourceSnapshot[], signal: AbortSignal): Promise<ModelResult>;
}
function createCurriculumModel(): CurriculumModelPort;
interface CurriculumJobView {
  jobId: string; status: 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
  stage: string; eventCursor: number;
  result: { courseId: string; courseVersionId: string } | null;
  error: { code: string; message: string; retryable: boolean } | null;
  attempts: number; resumable: boolean;
}
class CurriculumJobs {
  constructor(db: Database.Database, model: CurriculumModelPort);
  create(scopeId: string, idempotencyKey: string, input: unknown): CurriculumJobView;
  get(scopeId: string, jobId: string): CurriculumJobView;
  list(scopeId: string): CurriculumJobView[];
  events(scopeId: string, jobId: string, afterCursor: number): { cursor: number; stage: string; message: string }[];
  run(scopeId: string, jobId: string): Promise<void>;
  resume(scopeId: string, jobId: string): CurriculumJobView;
  cancel(scopeId: string, jobId: string): CurriculumJobView;
}
```

模型适配用本分支实际支持的 `generateText` + `Output.object`，schema 后仍调用 parseCurriculumProposal。不提供任何可执行工具。系统约束、用户目标、教材数据分开；教材内“忽略规则/读取密钥”只是文本。输入只包含明确选中的章节及真实来源 ID/版本/锚点；不读取环境快照到 prompt，不记录 provider 原始请求头、URL 密钥或异常堆栈。

阶段固定为 sources→proposal→validation→waiting_user。创建事务保存规范化请求和选定来源清单；同 scope/key 相同请求返回同 job，异内容 409。一个 owner 同时仅允许一个 queued/running 编课任务，新增请求返回可解释 busy 错误，不排无限队列。

run 用 immediate CAS 领取 90 秒租约和随机 fencing token，每次外部调用前持久化 attempt、刷新租约；60 秒超时后确保失去租约的 worker 不能写结果。最大 3 次包括崩溃时结果未知的调用，预算耗尽不能通过 resume 清零。结构解析失败标 failed，合法结构但有来源/先修 issue 的结果保存为 waiting_user 草稿，不自动伪造结果。默认一次 run 只发起一次模型调用；失败后显示可重试原因，由用户显式 resume 决定是否消耗下一次预算，不另做自动重试循环。未知计费状态标 failed 并提示，等用户明确恢复。

`curriculum-jobs.ts` 另导出 `CurriculumJobError`，code 限 `JOB_BUSY`、`BUDGET_EXCEEDED`、`PROVIDER_ERROR`，分别映射 409/429/502；其余输入、scope 和冲突复用 LearningError。list 最多返回最近 50 项且只读。

模型输出验证后将整个 ModelResult 保存到 proposal_json 检查点，保留 modelId、promptVersion 和实际 token 统计（未知为 null，不能编造成本）；每个检查点保存和最终事务都校验当前租约 token 与 running 状态。任务模块在同一 immediate 事务中先检查 fencing token，再调用 saveGenerated，提交版本与任务 waiting_user/result/event；不会在外部模型调用期间持有 SQLite 事务。崩溃恢复从已有检查点继续，不重复已完成的模型调用。GET/get/events 均只读；过期租约通过 resumable 显示，只有 POST resume 才重排。cancel 后旧 worker 的结果被 fencing/status 检查拒绝；课程已确认后不可取消。激活事务将关联任务置 succeeded。

- [ ] **Step 1：写失败测试。** 注入可计数的 model port，真实 DB 检查同键只有一个任务/课程，过期租约接管、双 worker、取消后迟到结果、保存 proposal 后进程重开和第三次预算耗尽。

```ts
expect(jobs.create('a', 'request-1', input).jobId).toBe(jobs.create('a', 'request-1', input).jobId);
await jobs.run('a', jobId);
expect(jobs.get('a', jobId)).toMatchObject({ status: 'waiting_user', attempts: 1 });
expect(db.prepare('SELECT count(*) AS n FROM vl_course_versions').get()).toEqual({ n: 1 });
```

模型适配测试只 mock SDK/model 网络边界；断言无工具权限、实际选中章节/锚点、schema 拒绝虚构字段、超长教材调用前拒绝、供应商错误脱敏及 maxRetries=0。不把 mock 结果当作真实模型效果。

- [ ] **Step 2：运行** `pnpm test tests/verified-learning/curriculum-model.test.ts tests/verified-learning/curriculum-jobs.test.ts`。Expected：失败可归因于待实现行为。
- [ ] **Step 3：实现** 模型适配和任务状态机；无常驻线程或新队列框架。Next 接入只在用户 POST 后用 `after` 调度 run，数据库才是恢复依据。
- [ ] **Step 4：验证** 定向测试、全量测试、类型检查。Expected：全部通过；GET 恢复查询、重复请求和重开测试中的模型调用次数精确匹配。
- [ ] **Step 5：审查/记录** 隐私、预算与崩溃窗口；提交检查点：`✨ 新增可恢复的目标编课任务`。

## 任务 5：本机访问边界、显式初始化与新增 API

**Files：** 新增 `src/lib/verified-learning/local-access.ts`、`server.ts`、`http.ts`、`scripts/verified-learning-init.ts`；新增 `tests/verified-learning/local-access.test.ts`、`http.test.ts`、`initialization.test.ts`；修改 `package.json`/`pnpm-lock.yaml` 增加 tsx 开发工具与 `vl:init` 脚本。所有下表路径均位于 `src/app/api/verified-learning/v1/` 并新增对应 `route.ts`。

| 路由文件 | 方法与行为 |
|---|---|
| `access/route.ts` | POST 登录；DELETE 注销 |
| `textbooks/route.ts` | GET 已认证本地 owner 的旧教材摘要，不返回路径 |
| `sources/route.ts` | GET 已注册来源摘要；POST `{textbookId}` 从真实旧行显式建立 scoped 快照并返回章节 ID/标题/字数，主/补充角色由课程决定 |
| `courses/route.ts` | GET 课程摘要；POST ComposeRequest + Idempotency-Key，返回 202 ApiResult<JobView> |
| `courses/[courseId]/route.ts` | GET 最新设计，courseId 与 scope 双重匹配 |
| `courses/[courseId]/versions/route.ts` | POST `{baseVersionId, choices}` + Idempotency-Key，保存修订返回 201；不匹配 courseId 拒绝 |
| `courses/[courseId]/versions/[versionId]/activate/route.ts` | POST 显式确认，返回 200；只调用 CurriculumService |
| `jobs/route.ts` | GET 当前 scope 最近 50 项任务摘要，支持响应丢失后重新找回 |
| `jobs/[jobId]/route.ts` | GET 任务；只读，不启动模型 |
| `jobs/[jobId]/events/route.ts` | GET 一次性 SSE 回放，尊重 Last-Event-ID/cursor；无长驻监听，前端可重连 |
| `jobs/[jobId]/resume/route.ts`、`cancel/route.ts` | POST 显式恢复/取消；恢复后 after 调度，不能超预算 |

**Interfaces：** `local-access.ts` 导出 `LocalAccessError`（code/status）、`readLocalConfig(env)`、`loginLocal(db, request, input, config): {token, expiresAt}`、`requireLocalAccess(db, request, config): {scopeId}`、`logoutLocal(db, request, config): void`。`server.ts` 是 server-only 薄适配器，导出 `getVerifiedLearningServer(request)`，返回已认证上下文及按需构造的服务；模块导入不读库、不迁移。运行时只以 fileMustExist 打开本 worktree 允许的 data 库并检查 schema=2，不调用会自动建旧表的 getDb；未初始化返回 503。登录使用同一个显式数据库访问器但不要求已有登录；模型适配器直到任务执行才构造，GET 不需要模型 key。`http.ts` 导出信封/错误映射和有字节上限的 JSON 读取 helper；所有路由直接测试实际函数，而非只测试 wrapper。

配置为 `VERIFIED_LEARNING_LOCAL=1`、固定 origin `http://127.0.0.1:3101`、`VERIFIED_LEARNING_ACCESS_TOKEN`（管理员生成的 32 随机字节 base64url，不是模型 key）。未配置默认返回 503/功能未启用，不调用 DB 或模型。严格检查请求 URL/Host；写入/登录必须匹配 Origin；拒绝 Forwarded/X-Forwarded-*，不把用户头当回环绑定证明，文档仍强制服务绑定地址。

登录按 SHA256 后 timingSafeEqual 比较口令，5 次失败/分钟的本进程节流（明确仅本地、重启清零）；随机 32 字节 cookie token，数据库只保存 hash、8 小时过期和配置指纹。cookie `HttpOnly; SameSite=Strict; Path=/`，只因固定回环 HTTP 使用 Secure=false；禁止配置成公网 HTTP。重设口令使旧会话失效。scope 固定由服务端映射为该库的 `local-owner`，不从正文、查询或任意头推断。匿名、过期、注销后 cookie 401，跨 origin 403，跨 scope 404。请求身份检查在每条数据入口执行，不只放在 layout。

JSON 最大 128 KiB，登录 4 KiB，流式计数拒绝超限（不能只信 Content-Length）。信封为既定 contractVersion/requestId/data 或 error；领域错误 400/404/409/422，预算/限流 429，未初始化 503，模型故障 502，未知内部错误 500 且仅通用消息。均 no-store，不返回 token hash、密钥、绝对路径或堆栈。

显式初始化：`pnpm vl:init --db <当前worktree内已有SQLite文件>`；脚本不选择默认库，拒绝缺参数/不存在文件/不在本 worktree data 下的路径，用真实路径避免符号链接逃逸，打开前核验。直接打开 existing DB 并调用迁移，不经会自动改旧 schema 的 getDb。用户手动执行前告知备份路径和影响；测试只操作临时测试根。

- [ ] **Step 1：写失败测试。** 默认关闭时零 DB/model 访问；有效/错误口令、节流、过期、注销、配置轮换、非法 Host/Origin/forwarded、scope 注入、正文超限、所有动态 ID 越权及错误脱敏。

```ts
expect((await POST(anonymousRequest)).status).toBe(401);
expect((await activatePost(forgedCoverageRequest, params)).status).toBe(400);
expect((await GET(foreignJobRequest, params)).status).toBe(404);
expect(serializedResponse).not.toContain('SECRET_SENTINEL');
```

初始化测试断言：仅指定库变化、备份失败无迁移、重复执行安全；真实旧教材 POST 契约依然通过。after 在路由测试中替换为可控调度边界，不虚称真实浏览器后台执行已验收。

- [ ] **Step 2：运行** `pnpm test tests/verified-learning/local-access.test.ts tests/verified-learning/http.test.ts tests/verified-learning/initialization.test.ts`。Expected：新边界行为失败。
- [ ] **Step 3：实现** 上述本机边界和路由；动态 params 按安装版 Next 文档 await；不添加 middleware/全站鉴权，不迁移真实库。
- [ ] **Step 4：验证** 定向测试、全量测试、类型检查、`pnpm build`、diff 检查。Expected：全部通过；build 不创建 vl_ 表/任务、不需要口令或真实模型 key。
- [ ] **Step 5：审查/记录** 独立安全检查；提交检查点：`✨ 接入本机编课访问控制与接口`，生产环境未部署。

## 任务 6：可检查、可修订的课程确认页面

**Files：** 新增 `src/app/verified-learning/page.tsx`、`courses/new/page.tsx`、`courses/[courseId]/page.tsx`、`jobs/[jobId]/page.tsx`；新增 `src/components/verified-learning/local-login.tsx`、`course-designer.tsx`、`course-review.tsx`、`job-status.tsx`、`design-editor.ts`；新增 `tests/verified-learning/design-editor.test.ts`、`curriculum-ui.test.tsx`。修改 `vitest.config.ts` 支持 `tests/**/*.test.{ts,tsx}`，仅 UI 测试用 jsdom；新增两个 UI 开发测试依赖，保留 Node 测试默认环境。

`design-editor.ts` 仅处理浏览器编辑状态：`movePoint(choices, pointId, direction: 'up'|'down'): DesignChoices`、`toggleExcluded(choices, pointId): DesignChoices`，返回独立副本；真正合法性始终由服务端判断。组件从 props/HTTP DTO 获取数据，不导入 DB、模型、node:crypto 或服务器配置。

页面行为：

1. 独立入口说明仅本机使用；登录表单不保存口令到 localStorage/URL。登录后列出课程和明确的新建入口，旧导航/首页保持不变。
2. 新建表单选择主教材/可选补充教材和分析章节，展示字数与未分析范围；填写目标、教学提示词、已有基础、包含/排除偏好及 3/10/10 题量、难度、完成/掌握门槛。mastery 明示证据服务尚未接入。
3. 提交前生成 idempotency key；网络错误重试复用同 key，修改请求才换 key。仅将 key 与请求哈希放入 sessionStorage，禁止保存口令/教材/模型响应；刷新后可从入口最近任务列表找回未知响应的任务。成功后进入稳定 job URL，刷新 GET 恢复状态；2 秒轮询，隐藏页暂停，错误有重试按钮；不因轮询自动重跑模型。
4. 确认页展示目标/节点、必需先修、保留/跳过/重排/补充原因、来源原文与锚点、缺口和机器检查边界。可上下移动、排除/恢复、确认自报基础、带理由调整先修、批准具体补充来源；保存产生新版本。改目标/学习约定则带 baseVersionId 重新生成，不原地改写旧版本。
5. 未保存编辑、阻塞 issue、来源缺失或未勾选“已核对来源与先修”时禁用确认；服务端仍重复验证。409 保留当前编辑并提示重新载入，不静默覆盖。确认成功显示版本号和未接入增强学习的边界，不伪造学习入口。

正文/引用作为 React 文本渲染，不用 dangerouslySetInnerHTML、MDX 或动态 JSX；本阶段不把任意 URL 自动变成链接。窄屏单列，label/fieldset/aria-live、可见焦点，状态不只依赖颜色；加载时禁用重复提交但不丢失输入。

- [ ] **Step 1：写失败测试。** Testing Library 按用户动作断言：登录→选择教材→填目标→提交任务→获取草稿→移动/保存→确认。网络层 mock 不代替服务验证，搭配任务 5 真路由测试。

```ts
expect(screen.getByRole('button', { name: '确认课程版本' })).toHaveProperty('disabled', true);
expect(screen.getByText('教材缺少算法内容')).toBeTruthy();
expect(document.querySelector('script[data-injected]')).toBeNull();
```

再覆盖刷新恢复任务 URL、空教材/无配置、HTTP 401/409/422/503、无效数值、必需点被排除、先修人工调整、补充资料未批准、点击两次只发送一个请求、网络重试 key 不变、恶意来源文本与键盘操作。

- [ ] **Step 2：先配置独立 UI 测试环境，再运行** `pnpm test tests/verified-learning/design-editor.test.ts tests/verified-learning/curriculum-ui.test.tsx`。Expected：新交互断言失败，不把未安装 jsdom、server-only 导入错误或未匹配 tsx 的配置失败当作 RED。
- [ ] **Step 3：实现** 页面与组件，复用 globals.css 主题变量/旧表单风格；不重写 layout 或旧业务。
- [ ] **Step 4：验证** 定向测试、`pnpm test`、`pnpm exec tsc --noEmit --incremental false`、`pnpm build`、`git diff --check`。Expected：全部通过。浏览器验收由用户启动 127.0.0.1:3101 后在隔离测试数据上进行，至少检查桌面/窄屏、刷新、冲突、来源预览和无法确认缺口；真实模型调用须额外明确授权，未运行就标未验收。
- [ ] **Step 5：审查/记录** 完整分支审查，更新契约/协作说明/总设计实现状态与 Task 记录；提交检查点：`✨ 新增可验证课程设计与确认页面`。独立列出未测试的真实模型效果，不能由 mock 推断。

## 完成门槛与交接

- [ ] 六项任务的 RED/GREEN、全量测试及类型检查有本次执行证据；旧 208 项行为没有通过删测试“消失”。
- [ ] v1→v2 备份/事务、scope、并发、幂等、恢复和激活绕过测试通过；无生产迁移。
- [ ] 无业务更改混入 main，旧 API 响应不变；构建只新增本计划页面/路由，未引入秘密或自动模型调用。
- [ ] 页面交互自动测试通过；浏览器/真实模型两种验收分别记录，未运行不能宣称通过。
- [ ] code-review-expert 审查无未处理的阻断项；用户自行决定提交、后续主线同步和部署。

## 计划自审记录

规格映射：来源/先修与目标编课→任务 1/2；版本/确认及来源变化→任务 3；可恢复生成→任务 4；本机访问控制与显式迁移→任务 5；课程确认与可访问性→任务 6。后续阶段能力已明确排除。

已核对接口：CourseInput/AssessmentSettings 复用第一阶段；模型只产 CurriculumProposal；编课服务只接已保存的 scoped 来源与任务；HTTP 不暴露底层 activateVersion 或完成/诊断命令。课程派生与确认共享 compileCurriculum，避免两套规则。

自审已修正：来源角色不应改变快照身份；引用必须限定到已选择章节；任务表与会话表的生产/消费列在迁移任务内明确；迟到模型结果须与 head/fencing 双重比较；未初始化时不能借旧 getDb 自动创建数据库；来源升级不悄悄改变旧引用；UI 测试不用未安装的断言扩展；响应丢失后有任务列表可恢复；模型失败仅显式重试，减少自动计费歧义。

本计划由当前 agent 自审，没有调用独立子代理。执行前须由用户确认；预计实现与自动验收约 4—7 小时，真实模型调试/人工浏览器反馈另计，不把这一估计当作完成保证。
