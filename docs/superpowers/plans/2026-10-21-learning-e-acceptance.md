# E 批：旧课程兼容、画像与完整验收实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 或已选方式；不得为了旧接口兼容恢复不安全执行；有缺失历史明确展示而非伪造。

**Goal：** 新旧记录都找得到、可回看，旧课能安全继续，画像按课程隔离，完成整轮真实流程验收。

**Architecture：** 旧读取/进度补丁独立于增强评分；旧记录只读保留，缺证据的分数标 legacy。统一入口列出不同引擎，跨引擎切换显式，不改写旧表成绩。

**Tech Stack：** 现有 Next/SQLite/React 图表，A—D 服务；新增开发依赖 @playwright/test 用于可重复浏览器验收。

**Spec：** 已确认融合设计 §3.6/4/7；总入口 `2026-10-21-complete-learning-experience.md`。

## Global Constraints

继承总入口。旧数据库字段不变；笔记/成绩/课件没有保存的内容不能补写成历史；原教材 POST 成功/失败响应仍锁定。main 未提交改动不导入。新运行只使用 D JudgePort。

## Review Focus

- 旧课件存在被误认读完、旧章末题次数错误：E1。
- 历史题答案读取越权/旧代码路由仍可 host execute：E1。
- 同教材两课混用 KP 全局分数和热力图：E2。
- 历史回看/重试改变统计、时区跨日：E2。
- mock页面成功但真路由/重启/断网失败：E3。

## 任务 E1：v6 旧课历史与安全继续补丁

**Files：** 新增 `src/lib/verified-learning/legacy-study.ts`；修改 `migrations.ts`；必要兼容修改 `src/lib/agent/learn-flow.ts`、`src/app/learn/[courseId]/page.tsx`、`learn-shell.tsx`、`src/components/lesson-view.tsx`、`quiz-panel.tsx`、`src/app/api/lessons/[kpId]/route.ts`、`src/app/api/questions/route.ts`、`src/app/api/attempts/route.ts`，每处变更单独记录原因；测试 `tests/verified-learning/legacy-study.test.ts`、`legacy-http.test.ts`、`legacy-ui.test.tsx`、`migrations-v6.test.ts`，旧 tests/agent/learn-flow.test.ts 增量更新有意行为。

v6 `vl_legacy_study(scope,course_id,revision,cursor_json,read_kp_ids_json,bridge_draft_id)`；`vl_legacy_events(scope,course_id,key,request_json,result_json,created_at)`。旧 rows 不迁成 verified。新增 session 的源 engine 标识存在这些附表，别把旧 courseId 传增强 store。

`LegacyStudyService(db)`：`get(scope,courseId)`、`readLesson(scope,courseId,lessonId)`、`readAttempt(scope,courseId,attemptId)`、`completeReading(scope,courseId,kpId,expectedRevision,key)`、`saveCursor(scope,courseId,expectedRevision,cursor)`、`createUpgradeDraft(scope,courseId,key):FormDraft`。授权 local owner 由 A；lesson/KP/question/attempt都检查课程归属，无全局 ID 直读。

旧有课件先读已存记录，按 created可用字段/rowid稳定选取一次、记录引用，不 GET 重新生成；旧 lessons 无生成时间时明确未知，不编造时间。已有课件不能自动记已读；第一次继续提示旧记录未保存阅读完成，用户可显式确认该节已读，后续使用附表。旧数据已经提交的客观题记录保留“已做”语义，分数标旧引擎结果，不转证据。

已做题历史展示当时 content_json/user_answer/correct 和已存 answer；旧表未保存详细 feedback/explanation 则显示未保存，不 GET 调模型。未答题不得获取 answer_json；旧 questions 返回值必须新增服务端 allowlist projection，前端隐藏不是防泄漏。回看不能触发 POST questions/attempts。

**旧课程继续的兼容边界（实施选择，交接时向用户明确）：** 已存课件阅读和客观题继续在旧课程显示，但所有新作答写前幂等/归属检查；老答案规则标 legacy，既有旧全局 mastery 写入保持为旧结果，不混新画像证据。未生成课件/题组和旧 code 题不允许经旧执行器重新执行：提供“继续生成学习内容”引导创建增强草稿，从旧目标/模式/来源导入，需来源/先修确认后生成增强新版本；保存 bridge_draft_id 使重复操作只一个草稿。旧当前页保留回看，不把创建新版本叫无损自动升级。无法安全转换的旧 assert 题显示旧题记录并生成新的 stdio 题，而不是把 assert 拼接运行。

旧公共路由在本地增强模式开启时要求 A 身份；legacy questions API 仅返回已有安全展示题，生成缺题返回明确 UPGRADE_REQUIRED 响应（409）。旧 code attempt/旧代码出题验证路径无论功能开关都不得通过 HTTP 调用 node:vm/旧 runCode：返回 409 并指向桥接流程，功能关闭也不恢复不安全 fallback。已有记录继续可读。这是单独记录的有意兼容行为变更，保留旧纯函数文件供既有测试/历史参考但不通过 Web 暴露执行能力。

- [ ] **Step 1：失败测试。** 原课件存在仍未读，明确确认后进度推进；历史读100次DB/model不变；跨课程KP/attempt拒绝；重复客观提交不重复成绩；旧答题日志保留；旧缺解析显示unknown；旧代码提交不触发 vm/host；bridge双击只一草稿，返回旧页记录还在。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/legacy-study.test.ts tests/verified-learning/legacy-http.test.ts tests/verified-learning/legacy-ui.test.tsx tests/verified-learning/migrations-v6.test.ts`。Expected：行为/边界失败。
- [ ] **Step 3：实现** 只读历史+进度附表+升级草稿引导，兼容补丁不删除旧数据、不伪造旧会话。
- [ ] **Step 4：验证** 定向、全量、类型、build。Expected：旧教材契约不变；有意更改“课件存在即完成”测试改为显式完成并加回归原因；不得只删原断言。
- [ ] **Step 5：审查/记录** 独立兼容补丁范围；提交检查点 `🐛 分离旧课程回看与学习进度`。

## 任务 E2：按课程/版本筛选画像与统一入口

**Files：** 新增 `src/lib/verified-learning/progress-view.ts`；新增 `src/app/verified-learning/stats/page.tsx`、API `progress/route.ts`；组件 `course-picker.tsx`、`learning-profile.tsx`；修改新 navigation.tsx/course列表，旧 `src/app/page.tsx` 仅加独立入口链接；测试 `tests/verified-learning/progress-view.test.ts`、`navigation.test.tsx`、`profile-ui.test.tsx`。

**Interfaces：** `CourseRef={engine:'verified-v1'|'legacy';courseId:string;versionId?:string}`；`progressView(scope,ref,timeZone):{completion,attempts,mastery,reviewDue,dailyActivity,graph}`。查询必须 exact course/version/session关联；默认选当前课程，全部课程可汇总活动但不合并跨课 mastery。时区仅用于展示/UTC桶转换，服务器查询按明确合法 IANA zone，非法400；不同 timezone 不写新事件。

verified: lesson complete/有效尝试事件去重，read history/GET/重复keys不计；completion 通过 core 已完成活动，mastery 通过 D evidence projection。诊断与练习分开统计，不把 cursor/停留当答题数。graph 仅该课程大纲点/先修与真实证据，文本等价视图与颜色对应。

legacy: 从 attempts→questions.course_id 确认答题归属，只能展示旧成绩/完成数据；旧 knowledge_points 的全书全局分数不得假装某课特有掌握，课程级无可靠来源处显示“旧版教材级指标/不可按课程归属”，不给不真实精确百分比。旧笔记无法确定课程时显示教材级旧笔记单独区，不复制到每门课。

- [ ] **Step 1：失败测试。** 两教材/同教材两课/两版本数据隔离；同一事件重试只计1；回看统计不变；UTC跨日转换；3/5掌握规则与advisory排除；旧全局KP不伪装课程分数；无数据/归档历史可见。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/progress-view.test.ts tests/verified-learning/navigation.test.tsx tests/verified-learning/profile-ui.test.tsx`。Expected：隔离/渲染断言失败。
- [ ] **Step 3：实现** 明确标签和课程筛选，重用 ECharts/ReactFlow 展示组件而非改现有stats全局计算；不发模型/写事件。
- [ ] **Step 4：验证** 定向、全量、类型、build、diff。Expected：画像与真实记录相符，非默认最近一本书冒充当前课程。
- [ ] **Step 5：审查/记录** 统计归属；提交检查点 `✨ 按课程展示学习进度与证据`。

## 任务 E3：浏览器、故障恢复与真实依赖验收

**Files：** 新增 `playwright.config.ts`、`tests/e2e/complete-learning.spec.ts`、`tests/e2e/recovery.spec.ts`、`tests/e2e/accessibility.spec.ts`、`tests/e2e/helpers/fixtures.ts`；修改 package.json/pnpm-lock.yaml 增加 @playwright/test 和 `test:e2e`；新增 `docs/verified-learning/acceptance.md`；更新契约、协作说明、已确认设计的实现状态和 Task 进度，不把设计原文变成全已实现。

浏览器服务由用户在测试拥有的库/上传根启动，配置指向 127.0.0.1:3101；测试不自动起长期服务，不访问 data/app.db 或个人教材。可控 fake provider 仅通过服务器测试依赖注入启用，不新增公开 HTTP 假结果开关；真实模型验证是单独显式授权命令/流程，不能调用用户 key 作为默认测试。

固定三套教材/题目 fixture 覆盖 Python、JavaScript、C；普通 e2e 可使用fake JudgePort测试页面状态，真实 D test:judge单独门槛。server restart由用户执行或短生命周期测试拥有的子进程完成（不得终止现有服务器）；不得把页面刷新说成进程重启验证。

- [ ] **Step 1：写验收测试/预期。** 导入两书→去重→草稿输入保存→刷新→生成→改大纲→确认→读完→做客观题→代码运行→退出恢复→回看→笔记导出→课程画像。另覆盖归档/阻止关联删除/无关联确认删除，明确新课程可学习。
- [ ] **Step 2：运行失败路径。** `pnpm test:e2e`，Expected：未实现行为失败；若环境未启动则记录未运行，不当业务RED。网络中断/401/409/模型故障/判题unknown由可控边界注入。
- [ ] **Step 3：补齐缺口。** 任何发现的业务bug先新增所属Vitest回归并观察RED，再修最小代码；不依赖脆弱截图像素作为唯一验证。
- [ ] **Step 4：最终验证。** `pnpm test`、类型检查、build、`git diff --check`；有授权运行 `pnpm test:e2e` 和 `pnpm test:judge`。Expected：全部门槛通过；桌面/390px窄屏、键盘、焦点、文本替代、恶意内容不执行。真实模型记录实际调用次数/来源命中/范围违规，不用mock编造数字。
- [ ] **Step 5：完整审查/交接。** code-review-expert 对总 diff 做单独完整审查；若没有独立 reviewer 明确作者自审限制。记录每批提交或未提交文件范围、运行证据、已知限制、用户启动/备份/恢复步骤；不自动merge/push/部署。

## 整轮完成门槛

- [ ] A—E 功能及所有代码测试通过，没有把未完成代码题/旧课兼容藏成“后续优化”。
- [ ] Python 3、JavaScript、C 真实编译/运行/资源限制/故障分类验收完成；未完成则整轮保持部分完成。
- [ ] 浏览器完整路径、刷新/断网/重启/重复请求/跨课程隔离有证据。
- [ ] 无生产数据误改/删除，无main工作区改动；提交/合并/部署由用户另行决定。
- [ ] 文档明示旧记录局限、外部提交unknown、模型语义非形式保证、需要Linux隔离运行；不作未经测量的效果声明。
