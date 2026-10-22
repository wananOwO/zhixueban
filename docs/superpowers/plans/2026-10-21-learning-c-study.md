# C 批：可继续、可回看的学习工作台实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 或已选方式；先读总入口及 B 的确认/session 接口。代码题发布等待 D，不调用旧执行器。

**Goal：** 新课程能实际阅读和做客观题，关闭后继续原活动，历史回看无副作用，笔记归属明确。

**Architecture：** StudySession 计算活动；ActivityRun 固定该次课件/题组；cursor、未提交输入、历史成绩各自保存。GET 只读，显式 POST 触发生成/完成/作答。

**Tech Stack：** 第一阶段 reducer、A JobStore、B 固定来源与教学快照、React Markdown/KaTeX、SQLite、AI SDK、Vitest。

**Spec：** 已确认融合设计 §3.4/3.5 客观题/3.7 笔记；总入口 `2026-10-21-complete-learning-experience.md`。

## Global Constraints

继承总入口。生成≠读完，打开≠答题，历史回看≠复习作答；不能接受浏览器 complete_activity、diagnosedKnowledgePointIds、verifiedKnowledgePointIds。题目/作答永久绑定 courseVersionId/sessionId/runId，不按当前 active 版本重解释。

## Review Focus

- 两个标签页开始同活动/迟到内容生成：C1。
- 内容生成完成但没有读完不能前进：C1/C3。
- 未答题答案泄露、只信模型自报标签或没返回审校结论：C2。
- 历史读取触发生成、回看覆盖学习 cursor：C3/C4。
- 未保存答案/笔记冲突与跨课程同知识点混写：C3/C4。

## 任务 C1：v4 活动快照与课件生成

**Files：** 修改 `src/lib/verified-learning/migrations.ts`；新增同目录 `study-contracts.ts`、`study-service.ts`、`lessons.ts`、`lesson-model.ts`、`source-context.ts`；测试 `tests/verified-learning/study-service.test.ts`、`lessons.test.ts`、`source-context.test.ts`、`migrations-v4.test.ts`，补教材删除关联测试。

**Interfaces：** `RunRef={runId,sessionId,courseId,versionId,activityId}`；`ActivityRun=RunRef&{kind:ActivityKind,purpose:'scheduled'|'remedial',status:'generating'|'ready'|'completed'|'abandoned'|'failed',questionCount:number,knowledgePointIds:string[],contentId:string|null}`。`StudyView={session:StudySession,next:NextStep,currentRun:ActivityRun|null,cursor:StudyCursor|null}`。`StudyCursor={runId,blockId:string|null,offset:number,revision:number}`；offset 非负，blockId 必须属于固定课件。

v4 表：vl_activity_runs（scope/run_id、session/version/activity、purpose/status、内容引用/allowed知识快照），vl_lessons（scope/lesson_id、run_id唯一、markdown、blocks_json、citations_json、model/prompt版本），vl_question_sets（scope/set_id、run_id唯一、status、question_ids_json、allowed_ids_json、validation_json），vl_questions（scope/question_id、set_id、snapshot_json、published_at），vl_attempts（scope/attempt_id、run_id/question_id、key、request_json、answer_json、state、result_json、created_at；scope/run/question/key唯一），vl_session_heads（scope/version_id→session_id，默认继续唯一）、vl_study_cursors（scope/session_id、revision、cursor_json、answer_drafts_json），vl_notes（scope/note_id、engine/course/version/kp、revision、content_md）。另建 vl_study_requests(scope,session_id,key,request_json,result_json)，承载 start/complete/abandon 等服务复合操作幂等，与 run/任务/reducer 同事务，不只依赖 reducer 内事件。每表必要复合关联和 JSON/check，不能仅靠 ID 命名自证隔离。

`StudyService(db)`：`get(scope,sessionId):StudyView`、`start(scope,sessionId,expectedRevision,key):{view,job:JobView|null}`、`completeLesson(scope,sessionId,runId,expectedRevision,key):StudyView`、`changeMode(scope,sessionId,expectedRevision,key,mode)`、`abandon(scope,sessionId,runId,expectedRevision,key)`、`saveCursor(scope,sessionId,expectedCursorRevision,cursor,answerDrafts)`。start 在事务核对 next/current、创建/复用 run 并 dispatch start_activity；有现成内容时绝不新 job。对相同 current 活动的新 key 也复用，不创建两个活动副本。

B 确认返回 sessionId，C 初始化 head 只读选择该 session；首次 start 必须显式且幂等。旧已创建的多个 session 仍保留，head 不覆盖历史；切换版本由明确用户选择，不能打开自动迁移。

`selectSourceContext(version,knowledgePointIds,sources,maxChars=24000):{snippets,truncated}` 只从版本已批准来源和本活动点/先修引用取段落，确定性去重/排序，超出提示，不能混旧全局 embedding 维度。无有效来源不可生成带“已核验引用”的课件。

`LessonModelPort.generate(context,teachingSnapshot,signal):Promise<{markdown,citations,modelId,promptVersion}>` 受 A 预算/无工具权限；`runLessonJob(scope,jobId)` 保存最终正文+引用+固定 blockId后标 ready，绝不 completeLesson。模型结构/引用不满足则 failed，不显示不完整正文为已完成课件。同 job 失败显式重试，已有内容不重新生成；用户以后明确重生成另做新版本，不覆盖历史。

- [ ] **Step 1：失败测试。** start 双请求一 run/job；生成 ready 后 displayed 数组仍空；只有显式 completeLesson 增加 displayed；完成重试一次事件；abandon 后迟到结果不覆盖新 run；cursor 不改 session revision/进度；来源越界/超限/无引用阻止；重开 DB 后内容固定。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/study-service.test.ts tests/verified-learning/lessons.test.ts tests/verified-learning/source-context.test.ts tests/verified-learning/migrations-v4.test.ts`。Expected：行为断言失败。
- [ ] **Step 3：实现** 显式服务/lesson job，复用 core transition，无 HTTP 直接 reducer。无题库时 quiz start 返回待发布而非伪造完成。
- [ ] **Step 4：验证** 定向、全量、类型；新增源码/快照引用进入 A 删除阻止条件。Expected：只读 next/get 不产生事件。
- [ ] **Step 5：审查/记录** 生成/完成分离；提交检查点 `✨ 建立持久化学习活动与课件`。

## 任务 C2：题目快照、校验和客观题发布

**Files：** 新增 `src/lib/verified-learning/question-contracts.ts`、`question-model.ts`、`question-validator.ts`、`question-service.ts`；测试 `tests/verified-learning/question-contracts.test.ts`、`question-validator.test.ts`、`question-service.test.ts`。

**Interfaces：** 使用 B ProgrammingLanguage；所有代码题先定义同一契约，D 实现执行检查。

```ts
interface StdioCase { caseId: string; stdin: string; expectedStdout: string; visibility: 'sample'|'hidden' }
interface QuestionCandidate {
  type: 'choice'|'fill'|'code'; stem: string; options?: string[];
  answer: string; acceptedAnswers?: string[]; explanation: string;
  targetIds: string[]; declaredDependencyIds: string[]; citations: CitationInput[];
  language?: ProgrammingLanguage; referenceCode?: string; tests?: StdioCase[];
}
interface ReviewVerdict { ok: boolean; usedKnowledgeIds: string[]; answerConsistent: boolean; reason: string }
interface ValidationReport { structure: boolean; sources: boolean; knowledge: boolean;
  semanticReview: ReviewVerdict|null; execution: 'passed'|'not_applicable'|'unavailable'|'failed'; publishable: boolean }
```

StoredQuestionSnapshot 添加服务端 questionId/setId/run/version、validation、时间/模型/提示词版本。学生 DTO 逐字段投影，只含题面、选项、语言、公开 sample；未答题绝不含 answer/explanation/referenceCode/hidden tests/validation内部原文。第一阶段 toQuestionView 保持，新增类型不能滥用 spread。C1 StudyService.start 在本任务接入 QuestionService.enqueue：quiz/diagnostic 活动复用或排队题组，start 请求仍返回同一 run/job，页面不再挂载即发独立出题 POST。

`QuestionValidator.validate(candidate,context):Promise<ValidationReport>` 注入独立 ReviewPort 和未来 JudgePort；结构：choice 2—6 个互异选项、答案必须唯一指向一个选项；fill 非空 acceptedAnswers 最多 10 个，采用 CRLF→LF、trim 后精确匹配，既不 eval 也不自动数值转换；code 有语言/参考解/2—20 不同 tests，至少一个 sample 和一个 hidden，单输入/输出最多 32 KiB，题目总测试最多 256 KiB；题面最多 8,000 字符、解析最多 8,000 字符、单选项最多 1,000 字符；空 tests 不通过。主观开放答案不伪装 fill。

检查 targetIds/独立审校 usedKnowledgeIds 均为 allowed union 子集（正常题用 displayed/declared/diagnosed，而非 unlocked）；diagnostic 单独按目标范围允许测试未知知识但不转进度。审校模型缺结果、矛盾、未知点、失败全部不发布，不默认 ok；资料中的指令无工具权限。模型审校非形式化证明，ValidationReport 如实记录。

`QuestionService(db,ports)`：`enqueue(scope,runId,key)`、`runJob(scope,jobId)`、`getSetView(scope,runId)`；按 activity.questionCount 完整发布，不能少题静默成功。按最多 10 题/生成批次，拒题最多重试 2 次/批次，所有调用预算保存在 job；完成整个组前不开始作答，失败保留校验记录。代码题 C 标 unavailable，D JudgePort 后才能发布。

- [ ] **Step 1：失败测试。** 客观答案无效、虚报标签但独立审校超纲、审校未调用/无结论、坏来源、0题/重复题、缺题不能 ready；DTO 用深层 sentinel 搜索确保答案/解析/hidden 都不泄露；诊断与普通范围分离；现成题组 GET 无模型调用。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/question-contracts.test.ts tests/verified-learning/question-validator.test.ts tests/verified-learning/question-service.test.ts`。Expected：缺失行为失败。
- [ ] **Step 3：实现** 严格 schema、分离生成/独立审校/投影；没有 JudgePort 时拒 code 发布，不接旧 runCode。
- [ ] **Step 4：验证** 定向、全量、类型；真实 SQLite 与 fake model boundary，不把模型 mock 当语义质量证明。
- [ ] **Step 5：审查/记录** 无结论 fail-closed 与隐藏内容；提交检查点 `✨ 发布经校验的固定题组`。

## 任务 C3：客观作答、历史回看与笔记

**Files：** 新增 `src/lib/verified-learning/assessment.ts`、`history.ts`、`notes.ts`；测试 `tests/verified-learning/assessment.test.ts`、`history.test.ts`、`notes.test.ts`。

**Interfaces：** `AssessmentService.submit(scope,runId,questionId,key,{answer,expectedRevision}):AttemptView`；`AttemptView={attemptId,questionId,state:'pending'|'finished'|'infrastructure_error',result:null|{correct,feedback,explanation,category}}`。未完成结果无答案；同 run/question 首次正式提交成为该 run 的固定成绩，不同 key 重交不能重复记分，显式再次练习需新 remedial run（D）。input drafts 不生成 attempts。

客观题同一 immediate 事务写 attempt/result 与活动进度：只统计本 run 已发布问题的不同有效 finished 答案，达到 exact count 才 dispatch complete_activity；错题可完成 completed 策略，但不伪造 mastery。诊断题组每点一题（core 限 50），服务从实际独立答对点生成 diagnosed IDs，不能客户端传入。

`HistoryService.list(scope,sessionId)` 返回 run 摘要；`get(scope,sessionId,runId):HistoryView` 返回固定课件/已答问题题面与本人记录；仅 finished 的题开放其答案/解释，隐藏测试永远不展示。没有历史字段显示 unavailable，不 GET 调模型补齐。所有 history 方法 SQL 前后事件计数/模型计数应不变。

`NotesStore` list(scope,{engine,courseId,versionId?})、save(scope,noteId,expectedRevision,{courseRef,kpId,content})、exportMarkdown(scope,noteId)。只允许真实课程/知识点，版本归属明确，内容最多 100 KiB；导出固定内容/安全 filename，不写任意 Vault 路径，不导出密钥或本机绝对路径。note 无独立身份来源不能自动分配到其他课程。

- [ ] **Step 1：失败测试。** 重复/并发提交只一成绩；错题完成但无掌握；跨 run/question、伪造 question IDs 拒绝；记录事件失败全回滚；诊断只记录确证点；回看100次数据/事件不变；部分未答题答案不可见；同教材双课笔记隔离/CAS/导出安全。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/assessment.test.ts tests/verified-learning/history.test.ts tests/verified-learning/notes.test.ts`。Expected：缺失行为失败。
- [ ] **Step 3：实现** 服务端验证事实再调用 reducer，公开代码题暂只 pending/unavailable，不在主机执行。
- [ ] **Step 4：验证** 定向、全量、类型；mastery 此批可保持已完成但等待证据状态，D 必须接通后才完成整轮。
- [ ] **Step 5：审查/记录** 记分与回看分离；提交检查点 `✨ 保存作答历史与课程笔记`。

## 任务 C4：学习/历史页面与真实路由

**Files：** 新增 `src/app/verified-learning/learn/[sessionId]/page.tsx`、`learn/[sessionId]/history/[runId]/page.tsx`、`notes/page.tsx`；组件 `study-workspace.tsx`、`lesson-reader.tsx`、`question-panel.tsx`、`history-reader.tsx`、`note-editor.tsx`；API 在 `/api/verified-learning/v1` 新增 `sessions/[sessionId]/route.ts` GET、`start/route.ts` POST、`lesson-completion/route.ts` POST、`mode/route.ts` PATCH、`abandon/route.ts` POST、`cursor/route.ts` PATCH、`history/route.ts` GET、`history/[runId]/route.ts` GET、`runs/[runId]/route.ts` GET 当前run已发布课件/学生题组DTO、`runs/[runId]/attempts/route.ts` POST、`notes/route.ts` GET/POST、`notes/[noteId]/route.ts` GET/PATCH、`notes/[noteId]/export/route.ts` GET。测试 `study-http.test.ts`、`study-ui.test.tsx`。

UI 明确“继续学习”与“历史回看”视图；仅当前视图保存 cursor，每 1 秒节流/离页显示保存结果；阅读完成按钮 POST，GET 导航不开始/完成。新当前活动用显式开始按钮；未保存答案保留恢复，成功后锁该次提交；返回回看有“返回当前学习”按钮，不能用历史点击更新 current。

模式切换正在活动时要求完成或明确放弃，失败反馈可见并恢复按钮，不永远 loading。已发布内容渲染 ReactMarkdown 禁 raw HTML、限制链接协议、引用按钮打开本机真实来源；无动态 MDX/JSX。窄屏导航可折叠，内容保留 label/aria-live/focus/reduced-motion。

- [ ] **Step 1：失败测试。** 新课程实际开始→读完→客观练习→下一步；关闭重挂恢复题组/输入；回看不调用生成/完成接口；部分历史答案遮蔽；模式切换失败/显式放弃；笔记保存失败、离线、双标签页；XSS 来源/课件文本。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/study-http.test.ts tests/verified-learning/study-ui.test.tsx`。Expected：交互/安全断言失败。
- [ ] **Step 3：实现** UI 与 service 路由，一致的 session ownership；GET 无 side effects。
- [ ] **Step 4：验证** 定向、全量、类型、build、diff。Expected：新课程能学，不再显示工作台未接入；代码题等待 D 如实提示。
- [ ] **Step 5：审查/记录** 工作台完整路径；提交检查点 `✨ 接入继续学习与无副作用回看`。

## C 批门槛

- [ ] 新课程课件/客观题可执行真实闭环，已有内容重开不重生成。
- [ ] 回看/当前cursor/成绩/笔记隔离；所有读取不记分。
- [ ] 代码题未接入前 fail-closed，无宿主执行回退。
- [ ] 本批测试/构建/审查证据已记录，继续 D。
