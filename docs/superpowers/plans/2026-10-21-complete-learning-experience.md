# 完整学习体验融合实施计划（总入口）

> **执行要求：** 使用 `superpowers:executing-plans` 按下列分批计划逐项执行；如用户选择可用的独立子代理，再使用 `superpowers:subagent-driven-development`。任务勾选必须有实际验证证据。

**Goal：** 完成教材库、自动保存的建课草稿、可验证编课、继续/回看、Python 3/JavaScript/C 隔离判题、笔记/模板与课程画像的真实闭环。

**Architecture：** 第一阶段领域核心保持兼容；新增领域服务、显式增量存储与独立本地入口。模型输出先校验再发布；读取历史不执行生成或记分；文件/外部调用不跨越数据库长事务，持久化任务记录负责恢复。

**Tech Stack：** 当前分支 TypeScript、Zod、better-sqlite3、sqlite-vec、AI SDK、Next.js 16.4.2、React、Vitest；不升级原依赖。测试/显式 CLI 增加开发依赖 `tsx`、`@testing-library/react`、`jsdom`、`@playwright/test`，分别在需要的批次安装。

**Spec：** `docs/superpowers/specs/2026-10-20-complete-learning-experience-design.md`，用户已确认，三语言包含 C。原 verified-learning 总设计仍约束掌握规则与来源安全；发生冲突以本次确认的融合设计为准。

**计划状态：待用户审阅执行方式；未开始业务实现。** 取代已暂停的 `2026-10-20-verified-learning-curriculum.md`，后者不能作为并行执行计划。

## Global Constraints

- 只在 `E:/code/程序设计比赛-verified-learning` 的 `feat/verified-learning` 工作。起始 HEAD `7dc9145`；兼容主线快照 `cd591dc`；不动 main 未提交内容、不自行合并。
- 新业务 `src/lib/verified-learning/`，新组件/页面 `src/components/verified-learning/`、`src/app/verified-learning/`，新 API `/api/verified-learning/v1`，测试 `tests/verified-learning/`。子计划中的路径缩写均按本节展开。
- 旧 11 张表列名/含义不改；旧教材 POST 成功 200 `{textbookId,chapterCount}` 及 400/422 错误契约保留。必要旧入口安全/兼容补丁单独审查，不能继承旧 node:vm 执行风险或答案泄露。
- 模式 1/theory、2/practice、3/drill；默认题量 3/10/10、1—50 整数；完成和掌握分开；UTC ISO 时间；scope 由服务端认证提供。
- 本机入口 `http://127.0.0.1:3101`，默认关闭；不宣称公网可用。新增代码不记录模型 key、判题 token、宿主路径到前端或日志。
- 迁移只在用户明确的初始化命令中执行：文件库先 UUID 同目录备份，再 immediate 事务；导入模块/页面/构造/构建不迁移。真实迁移、后台服务、管理员命令由用户执行。
- 每任务必须 RED→GREEN、全量测试、类型检查。结束立即更新 Task/progress.md 与对应勾选；不能把模拟接口结果当真实模型/判题验收。
- 每批代码后使用 code-review-expert。禁止为清工作区删除用户数据；禁止自行暂存/提交/推送。提交检查点只记录范围，提交须另获明确指令。

## Review Focus

1. 同内容/同名教材、两书同段落序号、删除预览后新引用和文件清理失败：教材不可串用或误删；A 任务 2/3。
2. 自动保存冲突、生成期间继续编辑、确认响应丢失：草稿不丢，旧结果不覆盖新输入，正式课程只生成一份；B 任务 1/3。
3. 回看/刷新/模式切换/旧记录缺字段：读取不生成、不推进、不冒充旧学习证据；C 任务 1/3 与 E 任务 1。
4. C 编译失败、运行信号、隐藏输入回显、Judge0 丢 token 与迟到结果：分类准确、数据不泄露、成绩幂等；D 任务 1/2。
5. 跨 scope/version/课程、完整答案后的重做、模型缺审校结论、服务故障：不得伪造掌握或混合画像；C 任务 2、D 任务 3、E 任务 2。

## 分批执行顺序

| 批次 | 计划文件（同目录） | 验收出口 |
|---|---|---|
| A | `2026-10-21-learning-a-library.md` | 本机入口、教材预览/导入、归档、受保护删除 |
| B | `2026-10-21-learning-b-curriculum.md` | 自动保存草稿、提示词、可验证编课与幂等确认 |
| C | `2026-10-21-learning-c-study.md` | 新课程可阅读/做客观题、继续与回看、笔记 |
| D | `2026-10-21-learning-d-judge.md` | 三语言隔离执行、幂等判分、可信掌握证据 |
| E | `2026-10-21-learning-e-acceptance.md` | 旧课兼容、课程画像、完整浏览器和故障验收 |

五批属于同一轮；C 的代码题必须明确暂不可执行，等待 D，不能偷偷走旧执行器。全部结束才算本轮完成。判题环境预检在 A 开始前告知并在 D 真机验证前解决，避免全部 UI 写完才发现无法运行。

## 运行环境门槛与已核对证据

- Node 24.18.0、pnpm 12.14.0；第一阶段本次已复验 24 文件/208 测试、类型检查和构建。正式开工时重跑基线，不复刻已有第一阶段。
- Docker CLI 29.6.1 存在，但 `docker info` 无法连接 dockerDesktopLinuxEngine；尚未启动引擎或任何容器。
- Judge0 官方发布 API 当前返回 CE v1.13.1。该版本修复 <=1.13.0 三个严重漏洞；官方仅测试 Linux，推荐 Ubuntu 22.04/cgroups v1，server/worker 需要特殊权限。不能把主线简略 compose 或 Windows Docker 当已验证部署。
- 计划使用独立 Linux 判题环境（本机 Linux VM，或用户自行提供且经本地隧道访问的可信 Linux 实例）；具体创建/高权限启动必须单独征得用户许可。没有环境时可完成接口与测试，但 D 真机验收保持未完成，不回退宿主运行。
- 参考：`https://github.com/judge0/judge0/releases/tag/v1.13.1`、对应 tag 的 `judge0.conf`/`app/jobs/isolate_job.rb`、官方 security advisories。执行时重新检查更新和公告；不使用浮动 latest，也不声称旧镜像包含的运行时是现代受支持版本。

## 跨批接口与数据边界

### 数据迁移

| 版本 | 所属批次 | 增量表组 |
|---|---|---|
| 1 | 已完成 | 原 vl_course_versions/study_sessions/learning_events/schema_migrations |
| 2 | A | vl_web_sessions、vl_jobs、vl_job_events、vl_books、vl_source_revisions、vl_deletions |
| 3 | B | vl_drafts、vl_draft_requests、vl_course_reviews、vl_course_heads、vl_templates |
| 4 | C | vl_activity_runs、vl_study_requests、vl_lessons、vl_question_sets、vl_questions、vl_attempts、vl_session_heads、vl_study_cursors、vl_notes |
| 5 | D | vl_judge_runs、vl_evidence、vl_hint_events |
| 6 | E | vl_legacy_study、vl_legacy_events |

只给增量迁移加版本与必要列，不重建旧表；每次升级备份到 `<db>.vl-vN-<UUID>.bak`，一次 immediate 事务应用所有缺失版本。部署到版本 N 时，>N 必须拒绝，不能吞掉“不支持”错误。旧 migrateVerifiedLearning(db) 调用方式不变。

所有业务表以 `(scope_id,id)` 或 scope+业务键隔离，事件/请求键包含业务资源；JSON/check 约束、CAS revision 和关联索引在拥有该数据的批次定义。密钥不入业务表；仅 session token hash 及配置指纹可入库。

### 有限任务记录，不建设通用工作流平台

A 导出 `JobStore`，支持固定 kind：`import`、`curriculum`、`lesson`、`question_set`、`assessment`；后面每种 runner 是普通函数，不用反射/插件框架。`JobView` 包含 jobId/kind/status/stage/eventCursor/result/error/resumable；状态固定 queued/running/waiting_user/succeeded/failed/cancelled。result 为 `null | {kind:'book'|'course'|'lesson'|'question_set'|'attempt'; id:string; versionId?:string}`；HTTP 编课响应投影为既有 `{courseId,courseVersionId}` 契约。

JobStore 提供 `create(scope,kind,key,input)`、`get(scope,id)`、`list(scope)`、`claim(scope,id)`、`checkpoint(scope,id,lease,stage,data)`、`finish(scope,id,lease,status,result,error)`、`resume(scope,id)`、`cancel(scope,id)`；claim 返回随机 lease token 或 null。90 秒租约，事务/迟到写入核对 token；外部调用前持久化 attempt，最长单次 60 秒。每任务每阶段有限预算写在子计划；GET 从不跑任务。after 只是 POST 后的执行触发，不是持久化保证；重启后用户显式恢复。

重复 key 相同规范化输入返回原结果，异内容 VERSION_CONFLICT。所有第三方调用都不在数据库事务内；第三方接收结果未知不自动重投，本地结果/事件/记分确保事务幂等。

### 课程与学习身份

B 的 FormDraft 是可变表单（revision CAS）；CourseVersion 仍是不可变版本，生成、确认分别发生，自动保存不是频繁 createCourseVersion。模板/语言/学科的实际快照保存在 course review 元数据，不擅自给第一阶段严格 CourseInput 加未知字段。

C 的 ActivityRun 是当前课程版本+会话+活动的一次内容发布/作答实例；回看按 runId 读取旧快照。StudySession 继续使用第一阶段 reducer；公开 HTTP 不接受 complete_activity/diagnosed/verified 等受信任事实。学习服务核对题目/作答后才调用 reducer。

D 的代码题统一单文件标准输入/输出测试，不拼接 JavaScript assert 到 Python/C。语言只能 python/javascript/c，不接受客户端编译选项、镜像或运行命令。保存实际 runtime 名称/版本与策略版本。

## 统一接口与页面约定

新 API 根 `/api/verified-learning/v1`，信封 `contractVersion:1, requestId, data` 或 `error:{code,message,retryable}`。本地访问配置缺失/未初始化 503，未认证 401，越权不可见 404，格式 400，冲突 409，领域校验 422，超限 413/429，外部服务 502；所有响应 no-store。业务错误码在 `errors.ts` 集中定义，原 LearningError 映射不改变。

新页面根 `/verified-learning`，从独立导航进入教材/草稿/课程/笔记/画像；旧首页只加一个明确入口，不重写布局。子计划列出精确端点与文件位置。动态 Next params await；server-only 边界不进入客户端包；按安装版 Next 文档，而非旧训练记忆实现。

## 验证与交接

每任务运行其定向命令后运行 `pnpm test`、`pnpm exec tsc --noEmit --incremental false`；引入路由/UI 或批末再 `pnpm build`、`git diff --check`。保持原 208 个测试的行为覆盖，必要契约变更新增断言，不靠删失败测试过关。

真机验收单独 `pnpm test:judge`、浏览器 `pnpm test:e2e`，默认测试不得偷发模型请求、访问生产库或要求 Docker。真机命令若配置缺失必须失败/明确未验收，不能以 skip 报告为成功。启动 Next/判题、导入用户资料、真实模型费用均由用户先授权。

## 计划自审与重要取舍

- 任务覆盖已确认设计 §3.1→A；§3.2/3.3/模板→B；§3.4/笔记→C；§3.5/3.6→D；§4/全流程/画像→E。
- 不复制 main 新增设置/笔记代码。本分支仍采用原 provider 环境配置，UI 如实显示此边界。
- 学习所需材料从课程固定来源段落选择，本轮先使用确定性文字检索和上下文预算，不混用旧全局向量索引；旧检索索引的删除仍需正确清理。原总设计的增强 embedding 多配置索引评测不在本轮宣布完成，后续独立交付，避免凭薄适配假称隔离已证明。
- 初版 C 采用单文件标准输入/输出与 C11 兼容题目/参考解，实际 GCC 版本固定并展示；默认编译模式不承诺拒绝所有扩展；允许书中常用标准库，不做多文件工程、自定义链接库或任意编译命令。运行时/语言能力缺失就禁用相应题型并提示，不 silently 改成另一语言。
- 旧记录可回看；旧课缺失的新内容通过明确的增强版本草稿继续生成，旧历史保留。这不是静默升级；旧代码 Web 执行无条件禁用宿主 fallback，指向受控新流程。
- 自审修正：删除预览不提前删除/锁书、旧教材登记用 POST、课件/题组run复合幂等、草稿生成版本与自动保存分离、C 默认编译策略不虚构、复习到期不等于撤销掌握、旧执行器 HTTP 入口不因功能开关复活。
- 作者自审，非独立审查。环境未就绪、真实模型/浏览器未运行须在最终报告留下明确未完成项；生产迁移/提交/部署不包含在编码授权中。

预计代码与自动验收约 3—5 个工作日（每天约 6 小时）；Linux 判题环境准备和真实模型质量调试另计。该估计只用于排期，不替代逐批证据。
