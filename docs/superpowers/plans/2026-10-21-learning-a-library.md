# A 批：本机入口与教材库实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 或用户选定的 `superpowers:subagent-driven-development`；先读总入口，按任务 RED→GREEN，不执行真实删除/迁移。

**Goal：** 在独立本机入口管理教材，预览真实原文，安全处理重复导入、归档和删除。

**Architecture：** scoped 元数据连接不可变来源快照；新导入不调用旧上传的全局 chunk/向量写入器，旧教材只读登记后可以受保护地整理。DB 中持久化文件操作意图，外部处理后再提交完成事件。

**Tech Stack：** 沿用现有 Node/Next/SQLite/Zod/Vitest；本批增加开发工具 tsx、jsdom、Testing Library，生产依赖不升级。

**Spec：** `../specs/2026-10-20-complete-learning-experience-design.md` §3.1、4；**总入口：** `2026-10-21-complete-learning-experience.md`。

## Global Constraints

继承总入口全部约束。文件写入仅 `data/verified-learning/`；客户端不传路径；旧教材 POST 契约不变；删除前真实关联预检与执行时二次检查；本批不运行用户数据迁移或启动服务。

## Review Focus

- 关闭功能/缺库时 build/GET 无数据库写入：任务 1。
- 伪造本机请求、过期 cookie 与跨 scope：任务 1。
- 同文件并发上传、同名不同内容及解析失败重试：任务 2。
- chapter index 跨书、来源快照变更与脚本内容预览：任务 2。
- 预览后新增引用、路径逃逸、文件删除一半失败：任务 3。

## 任务 A1：显式 v2 迁移、本机身份与有限任务记录

**Files：** 修改 `src/lib/verified-learning/store.ts`（迁移部分），新增同目录 `migrations.ts`、`errors.ts`、`jobs.ts`、`local-access.ts`、`server.ts`、`http.ts`；新增 `scripts/verified-learning-init.ts`；修改 `package.json`、`pnpm-lock.yaml`、`vitest.config.ts`；测试 `tests/verified-learning/migrations-v2.test.ts`、`jobs.test.ts`、`local-access.test.ts`、`initialization.test.ts`。只把迁移 SQL 移到 migrations.ts，不顺便重构旧 store 方法。

**Interfaces：** 复用 `migrateVerifiedLearning(db)`；总入口 JobStore/JobView 在 jobs.ts 导出。`AppError(code,message)` 的 code 为 DISABLED/NOT_INITIALIZED/UNAUTHENTICATED/FORBIDDEN/PAYLOAD_TOO_LARGE/LIMIT_EXCEEDED/IN_PROGRESS/PROVIDER_ERROR/JUDGE_UNAVAILABLE/INTERNAL_ERROR，其他沿用 LearningError；HTTP 不回显未知异常原文。

`local-access.ts` 导出 `readLocalConfig(env)`、`login(db,request,token,now)`、`requireLocalAccess(db,request,now):{scopeId}`、`logout(db,request)`。`server.ts` 导出延迟创建的 `openVerifiedDb()` 和 `getLocalServices(request)`，不在 import 时读库；`http.ts` 导出 `readJson(request,maxBytes)`、`ok(data,requestId,status=200)`、`fail(error,requestId)`。

v2 表字段（除 token_hash 外均含 scope_id，常规 ID 非空、JSON 有效、时间 UTC）：

| 表 | 关键列/约束 |
|---|---|
| vl_web_sessions | token_hash 主键、scope_id、expires_at、config_fingerprint |
| vl_jobs | job_id 主键组成、kind、key、input_json、state/status、stage、attempts、lease_token/until、checkpoint_json、result_json、error_json、created_at/updated_at；唯一 scope/kind/key |
| vl_job_events | scope/job_id/cursor 主键、stage、message、created_at；与状态提交同事务 |
| vl_books | book_id、origin=owned/legacy、legacy_id、file_relpath、file_hash、status=processing/ready/failed/deleting、archived_at、revision、created_at；scope/file_hash 对非空值唯一；legacy_id 的 scoped 唯一 |
| vl_source_revisions | scope/book_id/source_revision 主键、snapshot_json、created_at、revoked_at；不可覆盖 |
| vl_deletions | deletion_id、book_id、revision、state=prepared/cleaning/failed/done、impact_json、manifest_json、error_code；每书一个未完成删除 |

JobStore 方法输入如总入口，checkpoint/result 序列化只接受 JSON；claim/checkpoint/finish/resume/cancel 都 immediate + fencing token，claim 的成功/失败有精确测试；未知外部调用结果标 waiting_user，不自动重试。每阶段 attempts 保存于 checkpoint 的阶段记录，不被 resume 清零。

本机身份采用 `VERIFIED_LEARNING_LOCAL=1`、`VERIFIED_LEARNING_ACCESS_TOKEN`（32 字节随机 base64url），固定 origin `http://127.0.0.1:3101`。URL/Host 一致；写操作 Origin 必须匹配；不信 Forwarded/X-Forwarded-*。Next 自身注入转发头与用户代理头的区别需用本安装版 HTTP 集成测试核实，不盲目拒绝框架合法头，也不能因此信任转发身份。

口令 hash 后 timingSafeEqual；5 次失败/分钟的本机全局限流（重启重置明确记录）；随机 token cookie，DB 只存 hash，8 小时有效、HttpOnly/SameSite=Strict/Path=/，只在固定回环 HTTP 下 Secure=false；配置指纹轮换使旧会话失效。scope 固定服务端 `local-owner`；公共接口绝不接受任意 scope。JSON 128 KiB、登录 4 KiB，实际流式计数，不能只检查 Content-Length。

CLI `pnpm vl:init --db <显式路径>`：只允许当前 worktree data 下的真实路径，备份后迁移；文件不存在时明确要求先初始化旧库或使用显式 `--create` 创建新空库（必须在输出说明），不能默默创建另一个库。生产代码无 auto migration。测试 CLI 接受测试根仅通过测试依赖注入，不加隐藏 HTTP 绕过。

- [ ] **Step 1：测试先行。** v1 数据链保留、v2 备份一次、DDL 失败回滚/>2 拒绝、空库与缺参数、两连接 CAS、事件失败回滚；默认关闭零 DB/model、401/403/404、过期/注销/口令轮换/限流、超大 body。`expect(importModule).not.toCreateTables()` 用真实库前后 schema 对比实现，不写无效自定义 matcher。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/migrations-v2.test.ts tests/verified-learning/jobs.test.ts tests/verified-learning/local-access.test.ts tests/verified-learning/initialization.test.ts`。Expected：待实现行为失败；依赖/配置错误先修正再观察 RED。
- [ ] **Step 3：实现** 最小迁移/访问/任务服务与 CLI；旧 store API 不变，tsconfig 不顺带升级。
- [ ] **Step 4：验证** 定向、全量、类型检查、build。Expected：全部通过，构建不要求 token/模型/真实 DB。更新旧“当前 schema=1”断言为 2，保留旧全部语义测试。
- [ ] **Step 5：审查/记录** 数据/身份/租约证据；提交检查点 `✨ 建立本机学习入口与显式任务存储`，不自行暂存。

## 任务 A2：教材导入、去重、来源快照与原文预览

**Files：** 新增 `src/lib/verified-learning/sources.ts`、`source-contracts.ts`、`library.ts`、`library-import.ts`、`storage-paths.ts`；新增 `tests/verified-learning/sources.test.ts`、`library-import.test.ts`、`library.test.ts`；新增页面 `src/app/verified-learning/page.tsx`、`textbooks/page.tsx`、`textbooks/[bookId]/page.tsx`；组件 `src/components/verified-learning/local-login.tsx`、`navigation.tsx`、`textbook-library.tsx`、`textbook-reader.tsx`。新增 API 文件按下表路径。

**Interfaces：** `SourceSnapshot={sourceId,sourceRevision,title,format,chapters:[{chapterId,title,paragraphs:[{paragraphIndex,text,contentHash}]}]}`，`SourceRef={sourceId,sourceRevision}`，`CitationInput=SourceRef&{chapterId,paragraphIndex,quote}`，`checkCitation(snapshots,citation)` 返回 `{ok:true,citation,paragraphText}` 或 `{ok:false,reason}`，reason 限 SOURCE_MISSING/REVISION_MISMATCH/ANCHOR_MISSING/QUOTE_MISMATCH。

`createSourceSnapshot(sourceId,tree)` 保留旧真实 anchor；新导入解析后由本层按顺序重建稳定全书索引，避免旧 globalParagraphCounter 并发影响；不修改旧段落类型。索引按值查找，不当作章节下标；重复 chapterId/anchor 失败。正文只 CRLF→LF，段落和来源固定字段 JSON 的 SHA256 带 `sha256:` 前缀，不带私有图片路径。

`LibraryService(db,storageRoot)`：`list(scope,query,archived)`、`get(scope,bookId)`、`readChapter(scope,bookId,revision,chapterId)`、`registerLegacy(scope,legacyId)`、`archive(scope,id,expectedRevision,value)`；`enqueueImport(scope,key,upload):JobView` 和 `runImport(scope,jobId)` 在 library-import.ts。方法返回 `BookView={bookId,title,format,status,archived,revision,sourceRevision,relatedCourses,chapters:[{id,title,characterCount}]}`，不传路径/全书至列表。

| API（根 /api/verified-learning/v1） | 行为 |
|---|---|
| `access/route.ts` POST/DELETE | 登录/注销 |
| `textbooks/route.ts` GET/POST | 搜索列表/上传（202 job），同文件返回已有书/任务且标 reused |
| `textbooks/[bookId]/route.ts` GET/PATCH | 元数据/显式归档或恢复（CAS） |
| `textbooks/[bookId]/chapters/[chapterId]/route.ts` GET | 精确版本段落分页，最多 100 段/页 |
| `jobs/route.ts`、`jobs/[jobId]/route.ts` GET | 最近 50 个任务/单任务 |
| `jobs/[jobId]/resume/route.ts`、`cancel/route.ts` POST | 受控恢复/取消，POST 后 after 执行 |

上传最大 50 MiB，扩展名白名单沿用旧格式，保存随机 ID 路径，hash 对原始字节计算；同 scope/hash 唯一且事务处理竞争。网络重复输入不能覆盖文件；相同 hash 不同文件名复用；不同 hash 同名各存。新解析走现有 parseTextbook，但不要调用旧 embedding/upsertChunks；新版本先用真实段落文字检索，旧索引保持原状。解析失败记录失败任务/拥有的暂存文件，显式重试不重复 book；完成时书 ready、快照、job/result 同事务。

旧教材通过 `textbooks/legacy/route.ts` GET 只读列出当前本地库摘要，再由 `textbooks/legacy/[legacyId]/register/route.ts` POST 显式登记元数据（origin=legacy，不在 GET 中写），legacy_id 不复制原文件；无法回查原文件 hash 时显示去重不可判定而非假定相同。新旧来源均只有授权 owner 可访问。

- [ ] **Step 1：写失败测试。** 两书相同 chapter/index 不串引用；index=7 准确定位；hash 变更新 revision；同文件并发只一书、同名不同内容两书；失败重试/取消/重开恢复；超限/路径穿越/解析脚本文本只显示不执行。UI 断言搜索/原文/课程入口和空态。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/sources.test.ts tests/verified-learning/library-import.test.ts tests/verified-learning/library.test.ts`。Expected：缺失行为失败。
- [ ] **Step 3：实现** scoped 来源与教材 UI/路由；Tests 可 mock parser 网络/格式边界，但至少 TXT/MD 实际导入；处理原文上限/分页，不全书塞前端 props。
- [ ] **Step 4：验证** 定向、全量、类型、build；真实旧 `tests/verified-learning/compatibility.test.ts` 仍通过。Expected：注册/上传写入显式，GET 无修改、无模型调用。
- [ ] **Step 5：审查/记录** 路径边界/去重/分页；提交检查点 `✨ 完成教材库与可回查原文`。

## 任务 A3：受引用保护的彻底删除

**Files：** 新增 `src/lib/verified-learning/library-delete.ts`、`tests/verified-learning/library-delete.test.ts`；修改 library.ts 处理 deleting；新增 API `textbooks/[bookId]/deletion/route.ts`，组件教材详情增加影响对话框，不建通用弹窗框架。

**Interfaces：** `inspectDeletion(scope,bookId):{bookId,revision,blocked,blockers:[{kind,id,title}],counts}` 只读；`prepareDeletion(scope,bookId,expectedRevision):{deletionId,impact}`；`confirmDeletion(scope,deletionId,confirmName):Promise<{state:'done'|'failed';retryable:boolean}>`；`retryDeletion(scope,deletionId)`。相关 POST 一律要求本机身份/Origin；确认输入教材显示名或明确二次按钮，不仅前端 confirm。

检查 legacy courses、notes via KP、增强课程版本（含 archived）、drafts、运行任务、lessons/questions/attempts/evidence/source 引用；后续表未迁移时用受控已知版本分支，不能忽略存在的表。A 用真实 v2 fixtures，B—E 必须补关联阻止测试。教材关系查询维护在 library-delete.ts 单一位置，子批次按新增表更新。

prepare 只登记影响清单与确认意图，不把教材提前隐藏/锁死；用户关闭对话框可直接放弃 prepared 意图，未发生删除。confirm 在 immediate 事务重新查关联/版本，才置 deleting 并禁止后续注册引用；后续生成/确认也须检查该状态，不能只靠删除端检查。将应用拥有的文件 manifest 写入 vl_deletions，清理到应用内 quarantine 后提交 DB 删除，再清理 quarantine；各步记录，可重入，不在 DB 事务内长时间文件 IO。二次检查发现引用时不动文件。缺文件幂等，越界/symlink/reparsepoint/共享路径拒绝，不删用户最初上传的外部原文件。

legacy 清理须先保存目标 chunks.rowid，正确加载 sqlite-vec 后删除对应 chunk_vectors 与 chunks；删除仅该教材所属知识图谱且不存在跨书引用，最后教材行。无法确认索引/关联安全时失败关闭，不“尽力删一半”后报成功。备份文件不在清理范围。

- [ ] **Step 1：写失败测试。** 引用被阻止，归档不解除；预览后新课程阻止；两连接删除/新引用竞争；失败重试可恢复；缺文件/索引、只删目标向量 rowid、跨书边、句柄占用、路径逃逸、原文件共享保护；新草稿/课程引用须加入同一受控测试清单。
- [ ] **Step 2：运行** `pnpm test tests/verified-learning/library-delete.test.ts`。Expected：上述删除安全断言失败；只在测试临时根执行文件删除。
- [ ] **Step 3：实现** 最小持久化删除状态/影响对话框；API 先显示阻止原因，不提供级联选项。
- [ ] **Step 4：验证** 定向、全量、类型、build、diff。Expected：全部通过，无生产数据删除；文件清理失败可见而非假完成。
- [ ] **Step 5：审查/记录** 破坏性路径单独审查；提交检查点 `🔒 增加教材删除预检与恢复保护`。

## A 批完成门槛

- [ ] 教材入口能实际导入/查看/归档/预览受保护删除，不只返回 mock。
- [ ] 身份、来源、去重、备份/迁移和删除竞争测试全绿，旧教材契约不变。
- [ ] 代码审查与本轮 test/typecheck/build/diff 证据写入 Task/progress.md。
- [ ] 本机服务/真实迁移未授权则保持未运行；不妨碍继续纯代码任务，不虚报浏览器验收。
