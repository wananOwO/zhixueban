# B 批：建课草稿与可验证编课实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 或用户选定方式；读总入口与 A 接口，不执行已暂停的旧 curriculum 计划。

**Goal：** 输入/生成/人工调整都能恢复，确认幂等，课程包含真实来源、先修与教学配置快照。

**Architecture：** 可变 FormDraft 与不可变 CourseVersion 分离；自动保存不调用模型。纯编课校验器被生成、编辑和确认共同调用；所有生成结果绑定启动时草稿 revision。

**Tech Stack：** 现有 Zod、SQLite、AI SDK、React 与 A 的 JobStore/UI 测试工具。

**Spec：** 已确认融合设计 §3.2/3.3/3.7；总入口 `2026-10-21-complete-learning-experience.md`。

## Global Constraints

继承总入口。默认题量 3/10/10、1—50；来源 1—4 个，选中正文最多 80,000 字符、候选知识点最多 200；超过明确提示分章而非静默截断。用户可以在模型调用前调整范围。开放界面不接收 scope、coverage、hash、diagnosed 或 verified 字段。

## Review Focus

- 保存失败、双标签页、离线输入不能被旧响应覆盖：B1/B4。
- 同草稿生成中修改输入与双击确认：B3。
- 排除项目仍需基础、先修环被自报遮蔽：B2。
- 选定章节之外伪造引用/补充资料未批准：B2/B3。
- 模板变更与新语言不能悄悄改历史课程：B1/B3。

## 任务 B1：v3 草稿和提示词快照

**Files：** 修改 `src/lib/verified-learning/migrations.ts`；新增同目录 `draft-contracts.ts`、`drafts.ts`、`templates.ts`；测试 `tests/verified-learning/drafts.test.ts`、`templates.test.ts`、`migrations-v3.test.ts`，更新教材删除关联测试。

**Interfaces：** 从 A 导入 SourceRef，从 core 导入 AssessmentSettings/LearningMode。以下类型归 draft-contracts.ts：

```ts
type ProgrammingLanguage = 'python' | 'javascript' | 'c';
interface DraftInput {
  title: string; textbookId: string | null;
  sources: (SourceRef & { chapterIds: string[] })[];
  goal: string; teachingPrompt: string; priorKnowledgeText: string;
  includedTopics: string[]; excludedTopics: string[];
  allowSupplementalSources: boolean; assessment: AssessmentSettings;
  mode: LearningMode; subjectType: 'computer'|'math'|'physics'|'biology'|'language'|'general';
  programmingLanguage: ProgrammingLanguage | null;
  templateSnapshot: { templateId: string; revision: number; content: string } | null;
}
interface FormDraft {
  draftId: string; revision: number; input: DraftInput;
  state: 'editing'|'generating'|'review'|'confirmed'|'discarded';
  generationJobId: string | null; generatedFromRevision: number | null;
  versionId: string | null; updatedAt: string;
}
```

`DraftStore(db)` 导出 `create(scope,key,input):FormDraft`、`get(scope,id)`、`list(scope)`、`save(scope,id,expectedRevision,key,input)`、`discard(scope,id,expectedRevision)`、`copy(scope,id,key)`。save 允许空目标/未选教材，生成才强校验；拒绝未知字段/非法 enum/count，模板快照不是客户端可信数据：选择模板只传 templateId+revision，服务端读值；自由教学提示词单独保存。新建/保存规范请求幂等键按草稿与操作隔离；copy 总生成新草稿，不能复用旧确认课程 ID。

v3 增加：`vl_drafts(scope,draft_id,revision,input_json,state,generation_job_id,generated_revision,version_id,created_at,updated_at)`；`vl_course_reviews(scope,version_id,draft_id,job_id,proposal_json,choices_json,report_json,teaching_json,confirmed_at)`；`vl_course_heads(scope,course_id,version_id)`；`vl_templates(scope,template_id,revision,name,content,subject_type,updated_at)`。请求幂等日志复用 JobStore(kind=curriculum) 不合适，另加 `vl_draft_requests(scope,draft_id,key,request_json,result_json)`，与 draft 更新同事务；课程确认用此相同资源日志，不发后台任务。

`TemplateStore(db)` 导出 list/get/save(scope,id,expectedRevision,{name,content,subjectType})，用户创建 templateId 由服务端生成；内置从六种固定 subject 白名单读取，严禁把任意 subjectType 拼文件路径。旧 prompt_templates 只读投影，不自动覆盖导入；模板修改不重写 draft/course 已保存快照。

discard 必须无运行 job，确认后不可丢弃正式课程；待确认版仅在没有学习会话/证据时清理本草稿拥有的未激活快照和引用，否则拒绝并提示。操作需要用户明确点击并二次确认，不能自动丢弃。

- [ ] **Step 1：失败测试。** 空草稿可保存；两连接旧 revision 冲突且不丢新输入；创建/保存/确认 key 重试；同教材两目标独立；copy 新身份；模板变更旧快照不变；非法 scope/语言/题量；discard 不删除别的草稿/正式历史。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/drafts.test.ts tests/verified-learning/templates.test.ts tests/verified-learning/migrations-v3.test.ts`。Expected：缺失行为失败。
- [ ] **Step 3：实现** v3 与 stores；题量复用 parseAssessment，填表解析与生成校验明确区分；新增迁移同样备份/回滚。
- [ ] **Step 4：验证** 定向、全量、类型、diff。Expected：旧表/旧版本完整；教材删除预检现在能看见 drafts/reviews 引用。
- [ ] **Step 5：审查/记录** 草稿幂等/CAS、模板快照；提交检查点 `✨ 保存建课草稿与可复用教学模板`。

## 任务 B2：纯候选图、先修闭包和来源报告

**Files：** 新增 `src/lib/verified-learning/curriculum-contracts.ts`、`curriculum.ts`；测试 `tests/verified-learning/curriculum.test.ts`、`curriculum-contracts.test.ts`、`curriculum-fixtures.ts`。

**Interfaces：** 来源与 hash 仅使用 A；DraftInput/语言仅使用 B1。导出：

```ts
interface CandidatePoint {
  id: string; title: string; prerequisiteIds: string[]; relatedIds: string[]; citations: CitationInput[];
}
interface CurriculumProposal { points: CandidatePoint[]; targetIds: string[]; declaredIds: string[] }
interface DesignChoices {
  targetIds: string[]; excludedIds: string[]; declaredIds: string[]; order: string[] | null;
  prerequisiteEdits: { pointId: string; prerequisiteIds: string[]; reason: string }[];
  supplementalSourceIds: string[];
}
interface CurriculumIssue { code: 'SOURCE_GAP'|'INVALID_CITATION'|'UNKNOWN_KNOWLEDGE'|
  'PREREQUISITE_CYCLE'|'EXCLUDED_PREREQUISITE'|'INVALID_ORDER'|'SUPPLEMENT_NOT_APPROVED'|'EMPTY_TARGET';
  knowledgePointIds: string[]; message: string }
interface CurriculumReport {
  input: CourseInput; issues: CurriculumIssue[]; includedIds: string[]; skippedIds: string[];
  decisions: { knowledgePointId: string; action: 'keep'|'skip'|'reorder'|'supplement'; reason: string }[];
}
function compileCurriculum(input: DraftInput, proposal: CurriculumProposal,
  sources: readonly SourceSnapshot[], choices: DesignChoices): CurriculumReport;
```

parseCurriculumProposal/parseDesignChoices 严格 schema，ID 非空/重复失败；引用每点最多 8，quote 1—2,000 字符；targetIds 不能含未知点。知识点图含先修/相关两类边，只有先修参与闭包；先检查整体 ID/自环/环（已有基础不能遮蔽），然后选目标+未满足先修；稳定 Kahn 顺序。未知外部先修如未自报仍保留缺口，不能删边或漏点当成功。

模型 declaredIds 仅提示，默认 choices.declaredIds=[]，用户明确选择才作为 declared；不制造 diagnosed/verified。用户排除的是节点，不是整章节。必要先修被显式排除显示阻塞，可恢复/声明/有理由修订关系；不自动替用户忽略。

只在 DraftInput.sources 的指定章节中验证引用，保持原全书 sourceRevision，不能重新 hash 子集冒充新全书。covered/supplemented/missing 完全从合法引用派生；出现坏引用不能被另一条好引用盖过。未批准具体补充 source 或全局关闭补充阻塞。

按排序后的相邻来源章节成模块，ID 为 JSON.stringify([sourceId,chapterId,连续组序号])；无来源显式缺口组。课程 sourceRevisions 为实际引用版本；CourseInput 仅含 core 支持字段；teaching/language/template 等伴随元数据在 service 保留。整体图循环始终阻塞；无效引用只对本次闭包内及自报依据检查，已跳过的无关点坏引用不应让无关目标永远无法确认。

- [ ] **Step 1：失败测试。** variables→functions→algorithms，functions 在游戏章；排除 game 不删 functions；无算法来源保留 gap；补充确认后通过；related 不拉进闭包；自报环、坏引用、未选章节、人工反序/漏点/重复点都阻塞，输入深拷贝。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/curriculum.test.ts tests/verified-learning/curriculum-contracts.test.ts`。Expected：关键输出和 issues 断言失败。
- [ ] **Step 3：实现** 纯校验器；可修复缺口返回 issues，结构损坏抛 INVALID_INPUT；无模型/DB/浏览器 import。
- [ ] **Step 4：验证** 定向、全量、类型。Expected：满足的报告可由第一阶段 create/activate 验证，不满足的无法确认。
- [ ] **Step 5：审查/记录** 闭包/来源/人工选择；提交检查点 `✨ 校验目标编课与必要先修`。

## 任务 B3：固定输入的生成任务与幂等确认

**Files：** 新增 `src/lib/verified-learning/curriculum-model.ts`、`curriculum-service.ts`；测试 `tests/verified-learning/curriculum-service.test.ts`、`curriculum-model.test.ts`。

**Interfaces：** `CurriculumModelPort.propose(input,sources,signal):Promise<{proposal,modelId,promptVersion,inputTokens,outputTokens}>`；`createCurriculumModel()` 使用现有 getModel，延迟到执行时创建；`CurriculumService(db,model)` 提供 `generate(scope,draftId,expectedRevision,key):JobView`、`run(scope,jobId)`、`getReview(scope,draftId)`、`saveChoices(scope,draftId,expectedRevision,key,choices)`、`confirm(scope,draftId,expectedRevision,key,{acceptSourceAndPrerequisiteReview:true}):{courseId,versionId,sessionId}`。初次生成与每次 saveChoices 都追加新的 draft CourseVersion，更新 vl_drafts.version_id，旧版不改；FormDraft.input 的常规自动保存不创建 CourseVersion。vl_course_reviews.version_id 与该快照一一对应。已有正式课程重建输入带服务端验证的 baseVersionId，不能客户端指定 courseId 接管他人课程。

模型用本安装版 `generateText+Output.object`，无可执行 tools；数据与系统约束分开，输出仍严格解析。每次 60 秒，8192 输出 token，SDK maxRetries=0；每 job 最多 3 次显式尝试，GET/刷新不调用模型。资料超过限制先在 UI 明示选章；来源 ID/摘录不得调用模型“修补”成虚构内容。

generate 保存输入版本/选中来源快照和任务；相同 key 重试返回原 job。run checkpoint 绑定该输入 revision；若草稿随后编辑，结果另存可查看，状态显示“来自旧输入”，不能覆盖新输入或允许直接确认。选择“使用此结果”须显式恢复对应输入并增加 revision，然后重新校验。此操作方法 `acceptGeneratedRevision(scope,draftId,expectedRevision,jobId)`，不得在 GET 做。

确认事务重查草稿 revision、来源 ready/not revoked/not deleting、最新 course head、全部报告无阻塞，存 teachingSnapshot（语言/学科/模板/完整教学提示词）、激活版本并创建对应 StudySession。双击/响应丢失同 key 只一个 course/version/session；原 session 后续保留，不按激活自动升级。

第一阶段 createSession 每次产生新会话，因此只在这个事务首次确认创建一次，并把 sessionId 保存在确认 result_json，C 的 session head 从该结果初始化。确认后草稿输入只读，编辑使用新草稿/版本，不覆写正式课程。

- [ ] **Step 1：失败测试。** 生成期间 save 不被旧结果覆盖；主动使用旧结果 revision 变化；重复生成/确认只一次；不同 key 不绕过已经确认；来源撤销/删除竞争拒绝；过期 head 冲突；坏模型/超时无 active 课程；事件失败回滚激活与 session。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/curriculum-service.test.ts tests/verified-learning/curriculum-model.test.ts`。Expected：待实现行为失败。
- [ ] **Step 3：实现** A JobStore fencing/CAS 与 B2 校验复用；模型生成后不绕过确认，错误反馈不包含内部 prompt/密钥。
- [ ] **Step 4：验证** 定向、全量、类型。Expected：确认产生可供 C 使用的 sessionId，不是旧引擎课程 ID；mock 不视为模型效果证明。
- [ ] **Step 5：审查/记录** 事务与输入版本竞争；提交检查点 `✨ 实现可恢复编课和幂等课程确认`。

## 任务 B4：草稿/确认页面和 HTTP

**Files：** 新增 `src/app/verified-learning/drafts/page.tsx`、`drafts/[draftId]/page.tsx`、`courses/page.tsx`、`jobs/[jobId]/page.tsx`；组件 `draft-editor.tsx`、`course-review.tsx`、`job-status.tsx`、`template-picker.tsx`（均位于 src/components/verified-learning/）；测试 `tests/verified-learning/draft-http.test.ts`、`draft-ui.test.tsx`。新增 route.ts 对应：

| 根 /api/verified-learning/v1 | 方法/行为 |
|---|---|
| drafts | GET/POST list/create |
| drafts/[draftId] | GET/PATCH CAS save；DELETE 明确丢弃（拒绝正式课程） |
| drafts/[draftId]/generate、choices、accept-result、confirm、copy | POST 服务方法，Idempotency-Key + expectedRevision |
| templates、templates/[templateId] | GET/POST、GET/PATCH；不接收机器路径 |
| courses | GET 仅正式 active/archived 摘要，草稿另外列 |

自动保存 800ms debounce，输入修改序号对应请求；迟到响应不能覆盖新输入；保存队列串行，409 不自动覆盖，保留本地输入/提示重新载入；离线只显示未保存状态，不假称服务器已保存。草稿 ID 与当前请求 key 可 sessionStorage，教材文本/口令/完整模板不放 localStorage。

编辑器包含 Python/JavaScript/C 语言选择（仅 computer 学科），教学目标自动带入语言偏好但不替代用户文字；模板选中时显示实际内容；显示来源选章字数、缺口、先修和确认边界。按钮状态不能替代服务端验证；键盘上下调整，不用拖拽库。

- [ ] **Step 1：失败测试。** 自动保存/重开恢复、保存失败不显示已保存、过期响应/409 保留编辑、生成中编辑、旧结果确认拒绝、网络重试 key 保持、双击确认一份、三语言/默认题量、XSS 来源文本、模板快照。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/draft-http.test.ts tests/verified-learning/draft-ui.test.tsx`。Expected：真实 UI 行为失败，非测试配置失败。
- [ ] **Step 3：实现** API/service 认证全覆盖及页面，GET 只读；确认后链接 `/verified-learning/learn/[sessionId]`（C 上线前明确显示此批尚待工作台，不宣称本轮完成）。
- [ ] **Step 4：验证** 定向、全量、类型、build、diff。Expected：全部通过；旧教材 API 保持不变。
- [ ] **Step 5：审查/记录** 页面+服务一致性；提交检查点 `✨ 接入自动保存草稿与课程确认体验`。

## B 批门槛

- [ ] 草稿不是课程版本；保存/生成/确认各自幂等且可恢复。
- [ ] 来源/先修校验可解释，正式课程保留语言/模板快照。
- [ ] A 删除预检识别所有草稿/课程引用；旧 208 测试行为保留。
- [ ] 整批证据落盘；继续 C，不把“可确认但不能学”称为整轮完成。
