# 前端模型交接文档：完整学习体验

> **真实验收已通过（2026-10-23）：** 开发库已显式升级到schema v4（备份 `verified-learning-dev.db.vl-v4-d39a3f4f-….bak`）。供应商改为 api.blanka.cc（OpenAI兼容）、模型 `[kiro量高缓]claude-opus-5-5`。独立验收库 `data/agent-acceptance-cf8ef07f-62a2-4577-a39f-1e683f4e9d93` 中，Agent 用15次请求自主完成：搜索/读取教材、联网保存2个 docs.python.org 中文页面、规划4节、逐节提交、终验通过；课件4305字、25条引用全部可回查（教材17、官方文档8），阅读状态未被自动完成。本次无工具错误，因此“真实环境下自动纠错”未被触发，纠错能力由本地故障注入测试覆盖。修复拼接重复小节标题后250测试、tsc、构建通过。
>
> **Pi Agent重构（2026-10-23）：** 当前生成入口已使用 `@earendil-works/pi-agent-core@1.4.0` 工具循环：读取/搜索教材、公开联网补充、分项提交、校验错误反馈同一会话、最终验收。普通文字不作为产物；前端显示执行进度、停止与继续任务。新增显式schema v4表 `vl_agent_states`，开发库未自动升级，需要停止服务后 `pnpm vl:init --db data/verified-learning-dev.db`（不加create，自动同目录备份）。
> 本地验证：33文件248测试，tsc通过；生产构建成功但有6条动态文件追踪警告，生产登录和Pi模块加载通过。浏览器建课/恢复/模型选择测试使用模拟响应；联网读取Python官方文档和公开搜索已实测。
> 用户授权的一次真实课件验收已用3/30次请求：Agent调用get_generation_state/list_sources后，供应商返回 `content_filter` 及“检测到敏感内容，无法响应”；停止调用，**没有完整课件成功产物**。记录位于 `data/agent-acceptance-26c8b81b-47cb-4374-8488-6986cfbc9b02/acceptance.db`，不是用户开发库。需用户决定后续验收，禁止隐瞒拒绝或把模拟测试称为真实成功。


> **生成超时策略更新：** 用户明确取消应用层生成超时。已移除 generateText 的60秒 AbortSignal；课程/课件/题组 worker 每30秒续租，结束清理心跳，进程退出后仍按90秒租约过期人工恢复；不自动重试。非HTTP错误同样记录异常名称、错误码和cause链消息（遮蔽凭据，不序列化请求/堆栈），避免超时、网络中断和结构化输出失败被覆盖。既有失败任务只保存了通用文案，原始异常不可追溯，不回填推测。229测试、tsc/build/diff通过，3分钟模拟长请求续租/失败清理通过；未重发用户模型请求。


> **编课字数策略更新：** 用户明确取消 80,000 字选中正文上限。编课将全部所选正文交给供应商，由其上下文限制决定是否接受；不截断输入。供应商 API 错误的 HTTP 状态和响应正文（仅遮蔽凭据）保存到任务并展示，不再替换为笼统课程生成失败；SDK仍不自动重试。当前真实草稿463,382字只读选材校验通过且输入未变。大教材+原始错误回归、浏览器错误显示通过；全量25文件224测试及构建通过，未调用真实供应商。


> **最新覆盖（2026-10-22 单一工作台）：** 用户明确程序未上线，无需任何旧版兼容。唯一首页为 `/`，删除 `/verified-learning` 重复首页、旧导入/新建/画像/学习页面和旧 API，不提供重定向。下文旧课兼容章节仅是历史交接记录，相关运行接口现已删除。当前导航只有首页、教材库、我的课程、课程草稿、设置；课程内保留学习、回看、笔记和进度。
> 教学方案替代独立学科+模板两个选择；教材选中即加入，章节需明确选择或全选。保存队列失败停止、重试保留 key；生成等待落盘，waiting_user进入审核，生成失败可返回编辑。
> `POST /api/verified-learning/v1/settings/models` 接收可选 `{provider,baseUrl,apiKey}`，查询 OpenAI 兼容/Anthropic 模型列表并返回 `{models:[{id,name}],truncated}`。只按用户点击查询，不保存临时参数、不生成内容、不回传密钥；更换地址或协议需明确提供新密钥。
> 本轮删除旧版专用 agent/RAG/统计、兼容端点及其测试，移除 xyflow/echarts/sqlite-vec 依赖。数据库文件与历史建表脚本不做破坏性删除，当前运行代码不再提供旧记录兼容功能。
> 验证：24 文件 / 222 测试、TypeScript、生产构建通过。真实浏览器五个导航入口均通过，旧网址返回404；建课保存→生成→审核→确认与模型拉取选择、失败恢复用浏览器模拟响应验证，无外部供应商费用。390px无横向溢出。未实测真实模型生成/Judge0/真实供应商模型列表。审查为作者自审，无独立审查者。


> 接手模型：先完整阅读本文，再检查工作区并开始前端接入。本文包含任务、实际 API、启动方式、交互规则和验收边界，无需依赖上一段聊天记忆。

## 用户最新要求与工作方式

用户正在赶比赛交稿，另一个模型负责前端。**优先交付能实际使用的页面，不重新做长篇规划，不扩大安全设计，不反复执行无关测试。** 沿用当前主题和已有组件；按页面跑必要的定向检查，交付前统一类型检查/构建。对不影响范围的技术细节自行决定，只有阻断接入或改变已确认功能时才询问用户。

## 工作目录与现场保护

| 项目 | 接手时应使用的值 |
|---|---|
| 工作目录 | `E:/code/程序设计比赛-verified-learning` |
| 分支 | `feat/verified-learning` |
| 原目录 | `E:/code/程序设计比赛`，当前为 main，有其他未提交修改，不操作 |
| 最近已提交 HEAD | 交接核验时为 `7dc9145`；本轮新增后端尚未提交 |
| 后端入口 | `src/app/api/verified-learning/v1/[[...path]]/route.ts` |

**重要：后端代码存在于当前工作区，不在上述旧提交里。** 不要 reset、clean、checkout 覆盖文件，不要把未提交内容当成垃圾清理，不要重新克隆旧提交后声称后端缺失。接手先只读检查 `git status --short --branch`，保留当前全部修改，不自动提交、合并或推送。

本文记录实际接口，优先于之前未实施的五批/18任务计划。接口细节冲突时读取现有 route 和领域服务核实，不凭旧计划改路径。后端位于 `src/lib/verified-learning/`；不要重写后端体系。联调发现明确的小缺陷，可以做有依据的最小修复并在交接结果中列明，不能用修改判分/进度含义来迁就页面。

## 本次前端任务

1. **入口与教材库**：本机登录、导航、搜索、上传、目录/原文、关联课程、归档/恢复、删除影响预览与确认。
2. **草稿与课程设计**：自动保存、模板选择、目标/基础/模式/题量/语言选择、生成进度、来源/先修/缺口展示、人工调整和确认。
3. **学习与回看**：继续上次位置、阅读完成按钮、答题与三语言代码输入、判题等待/错误/恢复、模式切换、独立的历史回看。
4. **笔记与画像**：课程/知识点笔记编辑和导出，按课程版本筛选进度、活动与掌握证据。
5. **旧记录兼容**：在统一入口区分旧课程和增强课程；旧课回看/继续使用本文接口，需要新内容时明确引导生成增强版本，不静默改写旧成绩。

新页面建议放在 `src/app/verified-learning/`，组件放在 `src/components/verified-learning/`；当前这些新页面尚未实现。先查现有 `src/app/layout.tsx`、`globals.css`、`src/components/lesson-view.tsx`、`quiz-panel.tsx` 和图表组件，复用视觉风格与展示能力，但不要复用其自动生成/提交副作用。

所有 JSON 响应都是 `{contractVersion:1, requestId, data}`，错误为 `{contractVersion:1, requestId, error:{code,message,retryable}}`。前端不需要实现新鉴权框架、判题、证据规则或数据库访问，只调用本地 API。

## 本地启动（用户手动执行）

以下只在增强目录运行。初始化**会创建/迁移指定库**，首次针对新测试库执行 `--create`；已有教材库用原路径且不带 `--create`。升级先保留同目录 `.bak`。不要复制正在运行的数据库。

```powershell
Set-Location 'E:\code\程序设计比赛-verified-learning'
$env:VERIFIED_LEARNING_LOCAL = '1'
$env:VERIFIED_LEARNING_ACCESS_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:DB_PATH = 'data/verified-learning-dev.db'
pnpm vl:init --db $env:DB_PATH --create
# 按现有 provider 约定设置 LLM_API_KEY、LLM_MODEL、LLM_BASE_URL。
pnpm dev --hostname 127.0.0.1 --port 3101
```

登录口令在当前终端变量中，不是 LLM key；不要放 NEXT_PUBLIC、URL、localStorage 或源码。前端登录表单输入此值，服务设置 HttpOnly cookie。换终端/重启若重新生成口令，旧登录失效。跨源/localhost/其他端口不接受，统一 `http://127.0.0.1:3101`。

## 前端请求约定

```ts
const base = '/api/verified-learning/v1';
async function api(path: string, method = 'GET', body?: unknown, key?: string) {
  const response = await fetch(base + path, {
    method, credentials: 'same-origin',
    headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const envelope = await response.json();
  if (!response.ok) throw Object.assign(new Error(envelope.error.message), { status: response.status, code: envelope.error.code });
  return envelope.data;
}
```

Idempotency-Key 用 `crypto.randomUUID()`；同一操作网络重试保留相同 key，修改输入或用户明确新建才换 key。401 显示登录；409 保留当前编辑，重新 GET 后提示冲突，别自动覆盖；422 展示校验失败；502/503 显示配置/服务未就绪。

## 1. 登录、教材与任务

| 方法/路径 | 请求 | data |
|---|---|---|
| POST `/access` | `{token}` | `{expiresAt}`，cookie由服务设置 |
| GET `/access` | — | `{authenticated:true}`；未登录401 |
| DELETE `/access` | — | `{loggedOut:true}` |
| GET `/textbooks?q=&archived=false` | — | `BookView[]` |
| POST `/textbooks` | FormData `file`，需key | 201 `BookView`；解析过程中本请求等待，不是202 |
| GET `/textbooks/{id}` | — | `BookView` |
| PATCH `/textbooks/{id}` | `{expectedRevision,archived:boolean}` | 更新后的BookView |
| GET `/textbooks/{id}/source?revision=` | — | 完整来源快照，供选章；大书优先下面分页 |
| GET `/textbooks/{id}/chapters/{chapterId}?revision=&offset=0` | — | `{chapterId,title,paragraphs,nextOffset}`，每页100段 |
| GET `/textbooks/{id}/deletion` | — | `{bookId,revision,blocked,blockers}` |
| DELETE `/textbooks/{id}/deletion` | `{expectedRevision,confirmName}` | `{deleted:true,...}`；有引用422，前端先确认 |
| GET `/textbooks/legacy` | — | 旧库教材摘要 |
| POST `/textbooks/legacy/{legacyId}/register` | `{}` | 201增强BookView；不复制原文件 |
| GET `/jobs`、`/jobs/{id}` | — | 最近任务列表/JobView |
| GET `/jobs/{id}/events?after=0` | — | 事件数组（普通JSON，不是SSE） |
| POST `/jobs/{id}/resume`、`cancel` | `{}` | JobView；resume触发受支持runner |

BookView：`{bookId,title,format,status,archived,revision,sourceRevision,createdAt,chapters:[{id,title,characterCount}]}`。
来源快照：`{sourceId,sourceRevision,title,format,chapters:[{chapterId,title,paragraphs:[{paragraphIndex,text,contentHash}]}]}`。
JobView：`{jobId,kind,status,stage,eventCursor,attempts,result,error,resumable}`，status=`queued|running|waiting_user|succeeded|failed|cancelled`。2秒轮询，隐藏标签暂停。教材失败重试用原文件再次 POST，不用通用jobs/resume冒充有后台上传内容。

归档不破坏已学内容。彻底删除不能带走关联课程/成绩/笔记，阻塞清单显示给用户；旧导入原文件可能在应用目录外，接口只删除可归属的库记录，保留外部原文件。

## 2. 草稿、提示词与课程确认

| 方法/路径 | 请求 | data |
|---|---|---|
| GET `/drafts` | — | FormDraft[] |
| POST `/drafts` | DraftInput，可 `{}`，需key | 201 FormDraft |
| GET `/drafts/{id}` | — | FormDraft |
| PATCH `/drafts/{id}` | `{expectedRevision,input:Partial<DraftInput>}`，需key | FormDraft |
| DELETE `/drafts/{id}` | `{expectedRevision}` | `{discarded:true}`；正在生成/已确认拒绝 |
| POST `/drafts/{id}/copy` | `{}`，需key | 新草稿，不共享课程身份 |
| POST `/drafts/{id}/generate` | `{expectedRevision}`，需key | 202 JobView，后台生成 |
| POST `/drafts/{id}/choices` | `{expectedRevision,choices}`，需key | 校验后的FormDraft |
| POST `/drafts/{id}/accept-result` | `{expectedRevision}`，需key | 显式使用旧输入生成的结果，恢复对应输入 |
| POST `/drafts/{id}/confirm` | `{expectedRevision,acceptSourceAndPrerequisiteReview:true}`，需key | `{courseId,versionId,sessionId}` |
| GET `/courses` | — | 正式课程与snapshot/sessionId，不含草稿 |
| GET `/templates` | — | `{builtins,custom}` |
| POST/PATCH `/templates` | `{templateId?,expectedRevision?,name,content,subjectType?}`，需key | 保存的模板 |

DraftInput：

```ts
{
  title: '', textbookId: string | null,
  sources: [{sourceId, sourceRevision, chapterIds: string[]}],
  goal: '', teachingPrompt: '', priorKnowledgeText: '',
  includedTopics: string[], excludedTopics: string[], allowSupplementalSources: true,
  assessment: {pointQuestionCount:3, chapterQuestionCount:10, finalQuestionCount:10,
    difficulty:'easy', progressionPolicy:'completed'},
  mode:'practice', subjectType:'computer', programmingLanguage:'python'|'javascript'|'c'|null,
  templateId: string|null // templateSnapshot由服务端提供，不自行填写
}
```

FormDraft：`{draftId,revision,input,state,generationJobId,generatedFromRevision,versionId,review,confirmed}`。
state=`editing|generating|review|confirmed|discarded`。空表单可保存，生成时目标/主教材/选章必填。建议800ms自动保存，串行发送PATCH，成功才显示“已保存”；409保留本地文字。

review：`{proposal,choices,report,input,jobId,stale}`。report：`{input,issues,includedIds,skippedIds,decisions}`；每个issue有code/knowledgePointIds/message。问题存在时禁止确认，服务端也检查。生成期间修改表单会使结果stale，不能直接确认；可明确选“使用这次生成对应的输入”，调用accept-result。

choices：

```ts
{targetIds:string[], excludedIds:[], declaredIds:[], order:string[]|null,
 prerequisiteEdits:[{pointId,prerequisiteIds:string[],reason}], supplementalSourceIds:[]}
```

自报基础用 declaredIds，不允许前端写 diagnosed/verified。顺序包含完整所选知识点；必需先修缺失/坏来源/未确认补充会阻塞。题量1—50，最多4个资料来源；选中正文不设应用层字数上限，由供应商上下文容量决定。确认只产生一次版本和session；前端导航 `/verified-learning/learn/{sessionId}`（由前端新建页面）。

## 3. 学习、历史、作答和提示

| 方法/路径 | 请求 | data |
|---|---|---|
| GET `/sessions/{sessionId}` | — | `{session,version,next,currentRun,cursor}` |
| POST `/sessions/{id}/start` | `{expectedRevision}`，需key | `{run:{runId,status},job}`；job非空202 |
| GET `/runs/{runId}` | — | `{runId,status,activity,content,questions}` |
| POST `/sessions/{id}/lesson-completion` | `{runId,expectedRevision}`，需key | 最新StudyView |
| PATCH `/sessions/{id}/mode` | `{mode,expectedRevision}`，需key | 最新StudyView |
| POST `/sessions/{id}/abandon` | `{runId,expectedRevision}`，需key | 最新StudyView |
| PATCH `/sessions/{id}/cursor` | `{expectedRevision,cursor:{runId,blockId?,offset?,answers?}}` | 新cursor revision，独立于session revision |
| GET `/sessions/{id}/history` | — | 活动历史摘要 |
| GET `/sessions/{id}/history/{runId}` | — | 历史内容，已提交题带答案/解析，未答题不带 |
| POST `/runs/{runId}/attempts` | `{questionId,answer:string}`，需key | AttemptView；代码返回202 pending |
| GET `/attempts/{attemptId}` | — | AttemptView，轮询判题 |
| POST `/attempts/{id}/resume` | `{allowUnknown?:boolean}` | 显式恢复判题；unknown可能重复外部执行 |
| POST `/runs/{id}/hints` | `{questionId,level:1..4}` | `{level,content}`；level4影响独立证据 |
| POST `/sessions/{id}/remedial` | `{}`，需key | 掌握门槛补练run/job，后台生成新的题 |
| POST `/sessions/{id}/prior-knowledge` | `{expectedRevision,knowledgePointIds:string[]}`，需key | 显式自报基础（不冒充掌握） |

`next`：`{kind:'activity',activity}` / `{kind:'blocked',reason,knowledgePointIds}` / `{kind:'done'}`。
activity kind：lesson、point_quiz、chapter_quiz、final_quiz、diagnostic。

**交互重点：**
- GET session/run/history不生成内容、不完成活动。用户明确开始才 POST start，课件“生成好”不等于“读完”，点击读完才 POST lesson-completion。
- content 为 `{markdown,citations}`，安全Markdown渲染；引用点击教材原文。禁止动态MDX/HTML执行。
- questions 仅包含 questionId/type/stem/options/language/samples/attempt；选择题提交**选项文本**；code提交完整单文件代码；不传测试/标准答案。
- AttemptView：`{attemptId,questionId,state,result}`。state pending/running/finished/infrastructure_error/unknown；result `{correct,feedback,explanation?,category}`。服务故障/unknown不是答错。公开样例可显示，隐藏测试永不展示。
- 提示1—3目前为基础引导（概念/输入输出/分步），不是模型定制长提示；4显示该题完整解析。PRIOR_KNOWLEDGE_REQUIRED 时允许明确自报基础或切理论模式；MASTERY_REQUIRED 用补练，不能直接跳过。
- 回看独立界面，不保存当前cursor，不自动调用start/attempt；返回“继续学习”时读取session。
- 同一run/question只有一次正式提交；再次练习需新补练run，重复提交不能重复记分。

## 4. 笔记与画像

| 方法/路径 | 请求 | data |
|---|---|---|
| GET `/notes?courseId=` | — | 笔记列表，带noteId/courseId/versionId/knowledgePointId/revision/content |
| POST `/notes` | `{versionId,knowledgePointId,content}`，需key | 新笔记 |
| PATCH `/notes/{id}` | `{versionId,knowledgePointId,expectedRevision,content}`，需key | 更新后的笔记 |
| GET `/notes/{id}/export` | — | Markdown下载（非JSON信封） |
| GET `/progress?versionId=` | — | `{courseId,versionId,completedActivities,attempts,dailyActivity,verifiedKnowledgePointIds,knowledgePoints}` |

画像按明确version过滤，不拿最新教材全局分数冒充当前课程。掌握使用3道不同题、最近最多5道80%且最近独立正确规则；阅读和声明不算掌握。笔记只属于该课程版本的真实知识点，冲突409不自动覆盖。

## 5. 旧课记录与继续

- GET `/legacy/courses`：旧课程列表。
- GET `/legacy/courses/{courseId}`：旧课当前信息、已有课件/题目、补记阅读状态和cursor。
- GET `/legacy/courses/{courseId}/history`：旧课件与已做题记录，只读、不生成。
- POST `/legacy/courses/{id}/progress`：`{expectedRevision,cursor?,completeKnowledgePointId?}` + key，明确记录继续位置/读完。
- POST `/legacy/courses/{id}/attempts`：`{questionId,answer}` + key，已有客观题继续（标legacy），旧code不执行。
- POST `/legacy/courses/{id}/upgrade`：`{}` + key，将旧目标/模式/教材变为增强草稿，旧历史保留，确认后学习新版本。

旧记录未保存的解析显示“未保存”，别调用旧 GET lessons 假装历史回看。旧code API返回409 UPGRADE_REQUIRED；不要调用旧主机执行器。旧知识分数只标旧版结果，不映射verified。

## 6. 判题配置与当前限制

语言 `python/javascript/c`，服务必须由用户提供隔离 Judge0；没有服务时代码题校验失败，不发布、不回退宿主执行。

```powershell
$env:JUDGE0_URL = 'http://127.0.0.1:2358'
# 若服务启用鉴权：
$env:JUDGE0_TOKEN = '仅服务端保存'
# 可固定实际语言ID；不填时从 /languages 选匹配版本。
# $env:JUDGE0_C_ID = '50'
# $env:JUDGE0_PYTHON_ID = '71'
# $env:JUDGE0_JAVASCRIPT_ID = '63'
```

GET `/judge` 返回可用语言。C编译/运行都交给服务；accepted/wrong_answer/compile_error/runtime_error/time_limit/infrastructure_error分别显示。部署需正确禁网络、限制资源、隔离主机文件；项目没有自动启动服务，也没验证当前机器有可用Linux判题环境。

**交付状态边界：** 后端纯逻辑/数据库/路由/模拟判题有自动回归；真实模型质量、真实Judge0三语言运行和新前端浏览器联调需要实际配置后完成。后端交付时未实现新页面或容器部署。上一个 agent 的验证记录为35文件/285测试、TypeScript检查及生产构建通过（2026-10-21），最后小修后另有6文件/21项定向回归通过；这是历史验证证据，不代替接手后的改动检查，也不是实际供应商/判题环境保证。上传当前为同步解析，其余编课/课件/题组/代码作答采用持久任务/作答状态。不要在UI文案宣称“已完成所有生产验收”。

## 7. 接手后的执行顺序

1. 检查正确目录、分支和未提交文件；读当前布局与后端路由，**不要重做已完成的后端或重新询问整个产品范围**。
2. 先接登录、教材与草稿入口，再接课程确认；API不可用时显示真实原因，不用假数据掩盖。
3. 接学习/回看和笔记/画像，保留 Python 3、JavaScript、C 三种语言；判题环境未就绪不妨碍先完成页面和接口状态处理。
4. 跑受影响的定向测试，交付前运行 `pnpm exec tsc --noEmit --incremental false`、`pnpm build`、`git diff --check`；需要实际服务或费用的联调先取得用户授权，不自动迁移用户库或启动系统服务。
5. 在本文末尾追加接手结果：新增页面/路由、实际验证、未完成项及必要启动步骤。不要把未运行的真实模型/判题/浏览器测试写成通过；不擅自提交Git。

## 8. 前端完成检查

- [ ] 草稿显示真实保存状态；刷新恢复，冲突保留输入；重复点击/网络重试复用请求key。
- [ ] 确认课程后进入真实session；生成完课件不自动完成阅读；未完成活动切模式要求明确处理。
- [ ] 历史回看不调用生成/提交，不覆盖继续学习位置；只有已答题显示对应答案/解析。
- [ ] 归档可恢复，删除先查影响并二次确认；笔记/画像按课程或版本区分。
- [ ] 未配置模型/判题、网络错误、401/409/422/503等有可恢复提示；窄屏和键盘操作可用。

**接手立即动作：检查 `E:/code/程序设计比赛-verified-learning` 的 Git 状态，然后从本机登录与教材库页面开始接入。**

## 9. 接手结果（2026-10-22 前端接入）

### 新增页面与组件

页面（均在 `src/app/verified-learning/`，统一经 `Shell`（登录门禁+导航）包裹）：

| 路由 | 内容 |
|---|---|
| `/verified-learning` | 入口导航 + 最近任务状态 |
| `/verified-learning/textbooks` | 搜索、上传（幂等键复用）、归档/恢复、旧库登记 |
| `/verified-learning/textbooks/[bookId]` | 目录/原文分页、删除影响预览与输名二次确认 |
| `/verified-learning/drafts`、`/drafts/[draftId]` | 草稿列表/复制/丢弃；编辑器 800ms 串行自动保存、409 保留本地；生成进度轮询；review 面板（问题清单、目标/自报/排除、顺序调整、先修编辑带原因、补充来源认可、stale 时 accept-result）；确认后跳转学习页 |
| `/verified-learning/courses` | 正式课程列表（含 sessionId 入口） |
| `/verified-learning/courses/[courseId]?versionId=` | 按版本的掌握画像、近期活动、笔记增改与 Markdown 导出 |
| `/verified-learning/learn/[sessionId]` | start/课件「我读完了」/三题型作答（选择题提交选项文本、代码题公开样例展示）/判题轮询与故障恢复/提示 1—4/模式切换（有活动时先明确放弃）/blocked 两种处理（自报基础、补练）/cursor 自动保存与恢复预填 |
| `/verified-learning/learn/[sessionId]/history` | 只读回看：run 列表 + 详情（仅已答题显示答案/解析），不触发 start/attempt |
| `/verified-learning/legacy`、`/legacy/[courseId]` | 旧课程列表/继续阅读（补记已读与位置）/客观题继续作答/代码题提示升级/升级生成增强草稿 |

组件与客户端：`src/lib/verified-learning/client.ts`（信封解包、ApiError、类型）；`src/components/verified-learning/` 下 shell/auth-gate/error-box/markdown-view（安全渲染，不执行 HTML）/job-status/use-polling（2 秒、隐藏标签暂停）/draft/(chapter-picker、draft-form、review-panel）/study/(run-panel、question-card）。

辅助脚本：`scripts/smoke-frontend-api.mjs`（27 项 API 冒烟，口令从 `%TEMP%/vl-smoke-token.txt` 读取）。

### 联调发现并修复的后端缺陷（最小修复）

`src/app/api/verified-learning/v1/[[...path]]/route.ts` 新增 `normalizeDevUrl`：Next dev 服务器会把 `request.url` 主机名规范化为 `localhost`，与 Host 头（`127.0.0.1:3101`）不一致，导致所有请求被同源检查拒绝（403 FORBIDDEN）。修复方式是在路由边界按 Host 头还原 URL，`local-access.ts` 的严格校验（URL 必须为 127.0.0.1:3101）保持不变；`local-access.test.ts` 中「拒绝 localhost URL」等安全断言全部保持通过。

### 实际验证

- `pnpm exec tsc --noEmit --incremental false`：通过。
- `pnpm build`：通过，新路由全部出现在构建清单。
- `pnpm exec vitest run`：35 文件 / 285 测试全部通过。
- `git diff --check`：无空白错误（仅存量 LF→CRLF 提示）。
- 真实 dev 服务器（一次性库 `data/vl-smoke.db`，已删除）+ 冒烟脚本：登录/错误口令/教材上传/归档恢复/删除预览/草稿创建与自动保存/409 冲突/模板/任务/旧课/判题未就绪（502 JUDGE_UNAVAILABLE）/登出共 27 项全部通过。

### 未完成项

- 浏览器端真实交互联调未跑（本机 Chrome 未以调试端口运行）；页面仅验证了 SSR HTML 与全部 API 行为。
- 生成课程/课件/题组依赖真实 LLM 配置，判题依赖 Judge0，均未实测；前端对这些路径只做了状态与错误处理（轮询、失败重试、放弃活动）。
- 窄屏仅依赖 Tailwind 自适应类，未做真机检查。

### 启动步骤（与上文一致，补充口令格式）

口令必须是 43 字符 base64url（`randomBytes(32).toString('base64url')`），否则登录接口返回「本机学习入口尚未启用」。冒烟复现：初始化一次性库 → 启动 dev → `node scripts/smoke-frontend-api.mjs`。

未提交任何 Git 变更；工作区保留后端原有未提交修改与本次新增前端文件。

### 登录页循环刷新排查（2026-10-22）

- 使用本机已安装的 Chromium 与 Playwright 实测复现；拦截全部 API 后仍在 5 秒内发生 17 次主框架导航。WebSocket 持续收到 Turbopack 入口 chunk 的 `restart`，同期未检测到源码变化。已定位到开发热更新层；Turbopack 内部原因未进一步确认，不能归因于口令或数据库写入。
- 最小规避：`package.json` 的 `dev` 改为 `next dev --webpack`，其余脚本、后端实现、数据库均不变。
- 对照验证：同数据库、同口令，Webpack 下输入框内容保持 15 秒，期间额外导航 0 次，随后登录成功，浏览器页面异常 0 个。类型检查通过。未调用真实模型或判题服务。
- 本次浏览器验证覆盖登录稳定性，不代表其他页面全链路验收；此前「全部交互规则已落实」的结论超出了当时验证范围。

### 主页入口与供应商设置补齐（2026-10-22）

- 经确认，当前分支原先不存在设置页面；参考 main 的 settings 表约定，新增 `/settings`，通过现有本机登录保护的 `GET/PATCH /api/verified-learning/v1/settings` 读写当前供应商、模型、Base URL、API Key 和 Embedding 配置。网页配置优先于环境变量，后续模型请求立即生效；保存不调用外部模型。密钥不回传、空白密钥保留原值、无效配置整批拒绝。未搬入 MCP/Obsidian 等尚未接入增强后端的设置。
- 根首页与增强首页共用 `PageDirectory` 和 `src/lib/navigation.ts`：所有无需 ID 的页面均有直接入口，包括设置、增强功能、旧版教材导入/课程列表/新建课程/学习画像。公共导航补充设置和返回首页，旧版画像明确不代表增强掌握证据。
- 有 ID 的教材、草稿、课程、学习、历史及旧课详情仍通过实际数据列表/确认结果/课程内链接到达，不创建虚构 ID 链接。导航测试扫描所有静态页面，新增页面漏加目录会失败。
- 本轮验证：真实 Chromium 从根首页点击设置、登录、保存交互及清空密钥输入（浏览器保存响应模拟，不写用户配置）；从增强首页逐一点击 9 个入口均成功，390px 窄屏设置页无横向溢出、无页面异常。真实数据库保存/回读/模型配置生效在独立临时测试库验证。未使用真实供应商密钥或发起付费调用。
- 全量测试 37 文件 / 293 项通过，类型检查与生产构建通过。开发服务使用现有 3101 实例，未重启、未修改其数据库与供应商配置。
