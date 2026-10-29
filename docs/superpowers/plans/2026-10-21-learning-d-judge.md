# D 批：Python 3 / JavaScript / C 隔离判题与证据实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 或已选方式；代码与模拟测试可先做，真实服务部署/高权限操作须用户单独授权。任何未知结果不得自动算答错或重投。

**Goal：** 三语言程序先验参考解，再隔离判学生代码，保持可恢复且幂等的成绩/证据。

**Architecture：** 受控 JudgePort 与应用分开；持久化每个外部提交 token 与结果。学生程序只运行在受审查的判题环境，源码/输入不能选择工具命令；服务分类和业务正确率分离。

**Tech Stack：** Node fetch、SQLite、现有 TypeScript/Zod/Vitest；Judge0 CE 兼容 API，部署版本/镜像固定并重新检查安全公告；Linux 隔离运行。

**Spec：** 已确认融合设计 §3.5/3.6（用户明确增加 C）；总入口 `2026-10-21-complete-learning-experience.md`。

## Global Constraints

继承总入口。三语言标识 python/javascript/c，C 使用单文件 C11 标准输入/输出题；不支持 C++、多文件或任意编译参数。参考解与学生代码都隔离；不能用 node:vm/宿主 Python/GCC/JS fallback；服务故障不算学生错误。

## Review Focus

- C 编译失败与运行错误/资源耗尽/服务故障不能混为一类：D1。
- 外部 POST 响应丢失、已知 token 重开、迟到 worker：D2。
- 学生打印隐藏输入、通过错误堆栈回传答案/私有测试：D1/D2。
- 重做同题/看完整解析/课程跨版本不能伪造独立证据：D3。
- Linux 环境与编译期限制没有真实证明时不宣称完成：D4。

## 任务 D1：受控 JudgePort 与部署前预检

**Files：** 新增 `src/lib/verified-learning/judge-contracts.ts`、`judge0.ts`、`judge-health.ts`；新增 `scripts/verified-learning-judge-check.ts`；测试 `tests/verified-learning/judge0.test.ts`、`judge-health.test.ts`；文档 `docs/verified-learning/judge-setup.md`。部署配置仅在 D4 门槛后新增 `deploy/verified-learning-judge/compose.yaml`、`judge0.conf.example`，不能复制主线不完整服务片段。

**Interfaces：**

```ts
type JudgeOutcome = 'accepted'|'wrong_answer'|'compile_error'|'runtime_error'|
  'time_limit'|'memory_limit'|'output_limit'|'infrastructure_error';
interface JudgeSubmission { language: ProgrammingLanguage; code: string; stdin: string;
  expectedStdout: string; runtimeRevision: string }
interface JudgeReceipt { token: string }
interface JudgeResult { state:'queued'|'running'|'finished'; outcome?:JudgeOutcome;
  stdout?:string; stderr?:string; compileOutput?:string; timeMs?:number; memoryKiB?:number }
interface JudgePort {
  capabilities():Promise<{ languages:{language:ProgrammingLanguage;id:number;name:string}[];runtimeRevision:string }>;
  submit(input:JudgeSubmission,signal:AbortSignal):Promise<JudgeReceipt>;
  poll(receipt:JudgeReceipt,signal:AbortSignal):Promise<JudgeResult>;
}
```

Judge0 endpoint/token 仅服务器配置；只允许管理员固定回环/隧道地址，URL 用户输入不接受、重定向拒绝，不向公网发送学习代码。credentials 仅 header，日志脱敏。capabilities 通过 /languages 与 /config_info/health 可用端点核实实际语言版本；服务器配置固定 3 个语言 ID，对应名称必须匹配 Python3/JavaScript/C 而非 C++；C 编译器实际版本在能力页展示。runtimeRevision 对部署版本、语言名/ID和执行策略 hash；题目发布/学生作答两次一致，否则要求重新验证，不默默切版本。

受控默认执行策略：CPU 2 秒、wall 5 秒、内存 262144 KiB、总进程/线程 32、输出/文件 64 KiB、单代码 64 KiB；C 编译采用该已核对 GCC 的 C11 兼容子集题目；官方部署默认不额外传 compiler_options，应用只接受 C11 兼容单文件代码，不承诺 GCC 默认模式严格拒绝 GNU 扩展。若必须强制 `-std=c11`，须在受控语言配置固定并再验 capability，绝不开放浏览器编译选项。编译期也配置最大 CPU 10 秒/wall 20 秒/内存 524288 KiB/文件 10 MiB 等受控上限（编译使用 Judge0 MAX_*，执行使用单次更低的限制），与运行期分开验证。若 JS 引擎实际需要不同资源上限，先记录运行时依据和明确配置，不能删资源测试。max command args/additional files/callback/network 全关闭，服务不挂密钥/私人路径/docker socket。

POST `/submissions?base64_encoded=true&wait=false`，代码/stdin/expectedStdout base64；验证 JSON/token 类型/长度；poll 只查询必要字段并字节上限读取，超限返回 output_limit 或 infrastructure_error（仅执行器确证为 output 才该分类）。wall 时间单位**秒**，采用固定版本官方 API/配置，不照抄矛盾网页摘要。

状态映射：1/2 queued/running；3 accepted；4 wrong_answer；5 time_limit；6 compile_error；7—12 runtime_error（未确认的 SIGSEGV 不猜 memory）；13/14 infrastructure_error。memory/output 只有执行器确证理由时返回，未知 status/non-JSON/HTTP 5xx/认证失败/timeout 均 infrastructure_error，永不 accepted。语言禁用能力失败时不发布该语言题。

所有 stdout/stderr/compileOutput 是**后台原始结果**，不直接给学生，隐藏输入可能被学生自行打印。公开 sample 可截断展示，隐藏用例只给类别和汇总，不泄露输入/期望/标准解；编译诊断只限学生代码/白名单可展示部分，文件路径替换/长度截断。

- [ ] **Step 1：失败测试。** 三语言映射实际能力、C 非 C++、不接受自定义 options、状态全集/未知码、响应超限/base64坏数据/timeout/redirect；网络关闭和资源参数精确断言；隐藏输入 sentinel 不进入公开 DTO；SIGSEGV 不冒充 memory_limit。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/judge0.test.ts tests/verified-learning/judge-health.test.ts`。Expected：接口/分类失败，只有网络 boundary mock。
- [ ] **Step 3：实现** 最小 Judge0 适配和只读 health CLI；不拉镜像/启动服务。
- [ ] **Step 4：验证** 定向、全量、类型。Expected：全部通过；文档明确环境未真实验证。
- [ ] **Step 5：审查/记录** SSRF/命令/隐私边界；提交检查点 `🔒 增加三语言隔离判题端口`。

## 任务 D2：v5 外部判题恢复与一次记分

**Files：** 修改 `src/lib/verified-learning/migrations.ts`、`question-validator.ts`、`question-service.ts`、`assessment.ts`；新增 `judge-runs.ts`；测试 `tests/verified-learning/judge-runs.test.ts`、`code-publication.test.ts`、`code-assessment.test.ts`、`migrations-v5.test.ts`。

v5 增加 `vl_judge_runs(scope,run_id,owner_kind,owner_id,case_id,operation_key,runtime_revision,request_json,state,token,result_json,lease_token,lease_until,created_at,updated_at)`，唯一 scope/owner/case/operation_key；state prepared/submitting/unknown/queued/running/finished。owner_kind=validation/attempt，owner_id 必须 scoped 存在。另建 D3 用的 `vl_evidence` 和 `vl_hint_events`，字段见 D3，无平行迁移竞争。

`JudgeRuns(db,port)`：`prepare(scope,owner,case,key,input)`、`execute(scope,id)`、`resume(scope,id)`、`get(scope,id)`。事务先写 submitting，再外部 POST，得到 token 后立即存，随后 poll；进程死于 POST/receipt 窗口时状态 unknown，不自动重投。已有 token 只能继续 poll；用户明确重试 unknown 创建新执行尝试并警告可能执行过，不能保证外部 exactly-once；本地最终成绩唯一。

单个题测试逐个提交，最多 20；queued/running poll 每 1 秒，总 60 秒后保留 token+等待状态，不将队列延迟算学生 timeout。每次外部结果落库核对 lease/owner/current run，取消或旧 lease 不能覆盖；网络/服务失败留可恢复状态，不推进 activity 或 evidence。所有运行结果和最终成绩事务联动，失败不产生部分记分。

参考解验证完成所有 case accepted 才更新 ValidationReport.execution=passed；错误、空case、任何基础服务故障都不发布。独立 semantic review 同时检查测试与题意一致性及实际知识依赖，不因参考解过自造用例就保证零错误。课程题目语言在 B teachingSnapshot 中固定；不支持任意学生改语言绕过参考验证。

学生提交取服务端发布的测试/语言，不接受客户端 tests/expectedStdout。运行完成分类 correct=all accepted，compile/runtime/time/wrong 属有效错误；infrastructure/unknown 不算有效答题；hidden 结果只聚合。accepted/wrong 等事务写 attempt.result，达到活动有效答题数时调 core complete；异常重试仍同一次题目成绩，不新增热力图次数。

- [ ] **Step 1：失败测试。** C 参考编译失败不发布，三语言正确/边界错误；无用例不能全通过；丢 token unknown 不重投；已知 token 重开只 poll；重复提交/轮询/迟到结果只一成绩；混合 infra 与失败不得结束记分；隐藏回显/错误不泄露；触发器失败回滚 attempt/progress。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/judge-runs.test.ts tests/verified-learning/code-publication.test.ts tests/verified-learning/code-assessment.test.ts tests/verified-learning/migrations-v5.test.ts`。Expected：缺失行为失败。
- [ ] **Step 3：实现** 接入 D1、A 任务记录，不把外部执行放 DB 事务里。question-validator 的 code unavailable 改为真实验证结果。
- [ ] **Step 4：验证** 定向、全量、类型、build。Expected：错误分类/幂等精确符合断言，模拟成功不叫真机成功。
- [ ] **Step 5：审查/记录** exactly-once边界和隐私；提交检查点 `✨ 持久化代码判题与故障恢复`。

## 任务 D3：可信证据、提示使用和补练

**Files：** 新增 `src/lib/verified-learning/evidence.ts`、`hints.ts`；修改 study-service.ts、assessment.ts、store.ts（只增加服务器证据接入口）、question-service.ts；测试 `tests/verified-learning/evidence.test.ts`、`hints.test.ts`、`mastery-flow.test.ts`。

v5 `vl_evidence`：scope/evidence_id、session/version/run/question/attempt、kp_ids_json、correct、independent、verified_question、kind=objective/code/advisory、rule_version、created_at；scope/attempt 唯一。`vl_hint_events`：scope/event_id、run/question、level=1..4、content、created_at；同一已生成提示可读取，读取不新记一次；曝光 level4 必须持久化。

`projectEvidence(scope,versionId,knowledgePointId,now)` 返回 `{state:'unverified'|'verified'|'needs_review',validDistinctQuestions,accuracy,lastIndependentCorrect,verifiedAt,dueAt}`。只统计该 scope/课程版本的已验证客观/代码题；同一道 questionId 的首次独立有效作答入掌握窗口，反复做同题不扩样本。先至少3道不同题，再最近最多5道有效独立题正确率>=0.8且最新独立正确；完整解析曝光后的同题任何重做不 independent；普通提示另记但不混为全解析；服务故障/advisory不入窗口。

verifiedAt 首次达标记录，7天 due 只置 reviewDue=true 提醒（不是错误、不撤销已满足的进阶门槛）；有证据的复习错误才置 needs_review 并撤销当前掌握投影，保留过去证据。返回值另含 reviewDue:boolean、verifiedForProgression:boolean，evidenceReader 使用后者，不能因仅到期就把历史课程全部重新锁住。不得每次 GET now 重算 verifiedAt 把 due 无限顺延；新一轮达标时显式复核时间随事件更新。统计/投影规则版本固定 `mastery-v1`。

`VerifiedLearningStore` 构造增加可选服务器 `evidenceReader` 依赖，默认空集合保留旧行为；dispatch 在同一 DB 事务读取受信任 projection 后传 reducer，HTTP 不可提供 verified IDs。StudyService.get 同样投影，让 nextActivity 与 dispatch 一致，避免读能开始但写被阻塞。已有第一阶段 mastery 阻塞测试仍通过默认行为。

mastery 阻塞后不能死路：`StudyService.startRemedial(scope,sessionId,key,kpIds)` 创建 purpose=remedial run，必须由 blocked scope 限定、无正在活动，题组生成**不同题**，先达到3个不同题所需数量；补练作答写 evidence 不伪造 scheduled 完成，达标后原 nextActivity 门槛解除。下一次补练显式新 run，历史回看不创建。达到题量上限50照规则拆组，不无限循环。

`HintService.request(scope,runId,questionId,level,key)` 生成并保存提示；level4 可作为用户明确“查看完整答案”，首次曝光即污染该题独立证据；原历史已答题可展示既有完整解释，不能把历史页面重新加 evidence。完整解析生成失败则不展示虚构内容，但曝光答案的动作已发生必须记在状态中。

- [ ] **Step 1：失败测试。** 2道不达标、3道全对达标、4/5且最近错不达标、重复同题不凑数、解析后重做不独立、跨课/版本/subjective/infra排除、7天 due、不因读取延后、普通提示可见；mastery 需要补练→新题→解除并跨模式保持。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/evidence.test.ts tests/verified-learning/hints.test.ts tests/verified-learning/mastery-flow.test.ts`。Expected：规则断言失败。
- [ ] **Step 3：实现** 纯投影与持久事件/依赖注入，不改旧 scores；公开完成只由 assessment 服务产生。
- [ ] **Step 4：验证** 定向、全量、类型、build；core 默认store仍不凭完成制造 mastery，增强store可基于真实 evidence 过门槛。
- [ ] **Step 5：审查/记录** 规则与死路修复；提交检查点 `✨ 接入可追溯掌握证据与补练`。

## 任务 D4：三语言 UI、隔离部署文档与真实验收

**Files：** 修改 `question-panel.tsx`/study-workspace.tsx 显示语言、编译/运行分类、等待/恢复和补练；新增 API `attempts/[attemptId]/route.ts` GET、`attempts/[attemptId]/resume/route.ts` POST、`runs/[runId]/hints/route.ts` POST/GET、`sessions/[sessionId]/remedial/route.ts` POST；新增 `tests/verified-learning/judge-ui.test.tsx`、`tests/judge/three-languages.test.ts`、`vitest.judge.config.ts`；开发依赖/config脚本 `pnpm test:judge` 与 A 的普通 test 排除 tests/judge。更新 `docs/verified-learning/judge-setup.md`。

部署前明确向用户说明 Judge0 官方 Linux/cgroups/privileged 要求，选择隔离 Linux VM 或可信 Linux 服务通过本地隧道；不自行改 Windows/GRUB，不在存私人数据的宿主直接起 privileged compose。确认后提供固定版本/digest、server+worker+Redis+Postgres、非默认密码、关闭 telemetry/network/callback/additional-files/user-options、只回环监听的配置；服务密钥保留本地 .local，示例无真实 key。运行时镜像实际语言版本须展示并记录，不能用版本列表猜测。

真实测试用预先写死、可审阅的安全 fixture：Python/JS/C 的求和与边界输入、错误答案、无限循环超时、C 编译语法错误/运行错误；输出限额、网络不可达和不含敏感挂载的部署检查。资源压测只在测试专用 VM 内且有外层硬限额，不在用户主机生成耗尽进程等危险测试。黑盒接口测试加部署配置检查，不能只看请求 enable_network=false 就宣称网络隔离成功。

隐藏测试回显 sentinel 即使由学生主动输出也不回前端；学生可看公开样例诊断/编译错误，hidden仅结果。取消/错误/恢复按钮明确是否会再次执行；未知外部状态不能自动再投递。

- [ ] **Step 1：失败测试。** UI 精确显示三语言/编译错误/执行等待/服务故障不算错/unknown手动恢复，不能显示 hidden sentinel；test:judge 无服务必须报未就绪而非 skip成功。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/judge-ui.test.tsx`。Expected：交互断言失败；真实测试尚未获环境授权则标待执行，不伪造 RED/GREEN。
- [ ] **Step 3：实现** UI 和测试/部署文档，环境确认前不启动任何服务或安装系统组件。
- [ ] **Step 4：验证** 普通全量/类型/build/diff；用户准备环境后 `pnpm test:judge`。Expected：三语言真实通过，包括 C 编译期限制；没有环境则本任务保持未完成并记录 blocker，不阻止 E 纯代码工作。
- [ ] **Step 5：审查/记录** 运行时版本/端点脱敏/策略证据；提交检查点 `✅ 验证三语言隔离判题体验` 仅真实验收后使用。

## D 批门槛

- [ ] 三语言参考解/学生作答都经同一个受控运行时，无旧执行器回退。
- [ ] 外部状态未知、token恢复、本地记分和证据边界有事务测试。
- [ ] mastery 有补练可达路径，提示使用不伪装独立作答。
- [ ] 真机隔离/三语言测试通过并记录；未运行不得标完成。
