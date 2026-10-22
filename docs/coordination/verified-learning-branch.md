# 并行分支协作说明

## 当前状态

| 项目 | 值 |
|---|---|
| 主线分支 | main（接手核验：ac6f0a9；存在未提交修改，本轮未触碰） |
| 主线目录 | E:/code/程序设计比赛 |
| 增强分支 | feat/verified-learning |
| 增强目录 | E:/code/程序设计比赛-verified-learning |
| 初始分叉提交 | 094eda4 |
| 本次最后同步的主线提交 | cd591dc（已审阅快照，不含主线未提交改动） |
| 核验日期 | 2026-10-20 |
| 已复核核心提交 | 88834c6、d43b8aa（契约/版本）；f50dc00、e664c37（三模式/掌握门槛） |
| 本轮新增内容 | 显式增量迁移、scoped store、备份/事务/幂等/旧 POST 兼容测试 |
| 业务开发状态 | 用户已确认规格；第一切片本地核心已实现，尚未接入 UI/HTTP/认证/证据服务 |
| 第一切片验证 | `pnpm test tests/verified-learning`：5 文件/139 测试；`pnpm test`：24 文件/208 测试；`pnpm exec tsc --noEmit`、`pnpm build`、`git diff --check` 通过 |

仓库当前没有配置远程地址。本文描述本机分支协作，不表示已经推送远程。
桌面 worktree 工具未识别会话绑定的映射路径，因此使用 Git 原生 worktree；
两个目录已由 `git worktree list` 再次验证：原目录当前在 `main`，
增强目录仍在 `feat/verified-learning`。两者共享 Git 提交历史，
但各自的工作文件、暂存区和运行数据独立；无需在原目录切换分支。
增强分支最后提交为 `7dc9145`，第一阶段代码和完成记录均已提交。

## 写入边界

增强线只在自己的工作目录执行安装、测试、编辑、暂存和提交。
不切换主线目录的分支，不暂存主线改动，不复制未提交文件。
每个目录使用各自的 node_modules、.next、data 和环境配置。
禁止两个实例指向同一个 SQLite 文件、上传目录或实际 Vault。

默认开发端口建议：主线保留原端口，增强线使用 3101。
功能代码就绪前，本轮不启动新的后台服务。
将来运行增强线时，从增强目录执行 `pnpm dev --port 3101`，
只绑定回环地址的开发服务另加 `--hostname 127.0.0.1`。

## 接口同步

契约文件为 `docs/contracts/verified-learning-v1.md`。
当前契约已按 cd591dc 的真实代码核对；第一切片保留旧路由、schema、
provider 和依赖锁文件，未宣称主线已经采用增强接口。
不把“写了契约”描述为两条开发线已经建立自动同步。
提交本轮文档后，主线可用以下只读命令查看契约，无需切换自己的分支：

```text
git show feat/verified-learning:docs/contracts/verified-learning-v1.md
```

每个可交付切片开始前：

1. 在增强 worktree 检查自身状态和 main 的最新已提交内容。
2. 工作区干净后，选择明确的主线提交进行合并，不读取半成品替代提交。
3. 检查教材 API、共享类型、schema、provider 和依赖锁文件的变化。
4. 更新本文件中的对齐提交和契约差异。
5. 执行原测试与新增契约测试，再继续业务开发。

仅在增强 worktree 操作的同步命令形式：

```text
git status --short --branch
git log --oneline HEAD..main
git diff HEAD...main -- src/lib/db src/lib/textbook src/lib/rag src/lib/llm src/app/api package.json pnpm-lock.yaml
git merge --no-edit <reviewed-mainline-commit>
pnpm install --frozen-lockfile
pnpm test
```

`<reviewed-mainline-commit>` 必须替换为已经审阅的实际提交；
它是操作参数，不是尚未决定的产品要求。
不在有未提交改动时合并，不 force-push，不为保持干净而丢弃用户改动。
冲突先保留现场并列明契约差异，再协调处理。

## 提交与移植

提交按责任拆分：

1. docs：规格和契约，可单独 cherry-pick。
2. contracts/core：类型、纯状态逻辑和测试。
3. storage：增量表、迁移和兼容适配器。
4. learning：编课、出题验证、证据和判题端口。
5. web：独立页面、API 和主线入口接入。
6. compatibility fixes：必须修改共同文件的补丁，单独提交。

主线接收方先审阅 `git show <commit>`，在自己的空闲且干净的工作区选择
cherry-pick 或 merge。本分支不代替另一个 agent 执行主线合并。
新功能默认不抢占旧路由；入口接入提交可以最后应用。

快速切换优先通过访问不同端口的 worktree 实例完成，而非在正在使用的目录 checkout。
数据转移使用带版本的显式导出/导入，不复制运行中的 SQLite 数据库。
旧引擎未支持的内容显示转换报告，不保证所有增强状态无损降级。

## 交流边界

本轮用户要求接口同步，因此已建立可共享的契约和提交边界；
尚未向其他聊天发送消息，也未修改另一位 agent 的文档。
如果用户要求把本分支方案发给具体聊天，再使用聊天消息工具交接。
共享 Git 可查看本分支文档，不需要将文件直接写入主线工作目录。

## 第一切片交付边界

`src/lib/verified-learning/` 包含契约、纯课程构造器、三模式状态机和
显式 `VerifiedLearningStore`。四张 `vl_` 表只在调用
`migrateVerifiedLearning(db)` 后建立；构造、导入和旧应用启动均不迁移。
文件迁移先备份到同目录 UUID 文件再事务执行；测试只操作测试拥有的临时目录。
本轮没有生产库迁移、数据复制、主线合并、推送、部署或后台服务器。
验证保留既有 Vite 配置 CommonJS/ESM 提示和 Git LF/CRLF 提示，
未为消除提示修改共享配置；生产构建成功，未新增增强路由。

scopeId 只是隔离键，不替代认证；未来由服务端认证适配器提供。
完成/诊断命令是受信任后台事实；当前没有题目结果验证或证据服务，
掌握门槛继续阻塞，不把完成度当作掌握。课程激活只验证结构和 ID，
没有语义来源核验。旧教材接口仅锁定兼容响应，未顺便改旧失败回滚逻辑。

## 接手复核（2026-10-20 23:00）

- 第一阶段计划及任务 1—3 提交齐全；恢复前工作区干净，无待续写的半成品。
- 在 `7dc9145` 重新执行：`pnpm test` 24 文件/208 测试通过；
  `pnpm exec tsc --noEmit --incremental false`、`pnpm build`、`git diff --check` 均退出 0。
- 本地执行日志仍写“总审查待完成”，但最终计划提交已记录审查通过；
  已补充接手核验说明，没有把历史审查描述成本轮重新进行的独立审查。
- 仍保留历史兼容基线 `cd591dc`；本轮没有同步当前 `main` 的代码或修改其未提交文件。
- 接手时第二阶段尚无实施计划。用户随后确认进入完整第二阶段、仅本机使用、暂不合并主线；已编写
  `docs/superpowers/plans/2026-10-20-verified-learning-curriculum.md`。用户随后补充“第二轮：补完整学习体验”，
  要求融合教材库、学习继续/回看、建课草稿与重复创建修复；该计划现标为范围重议、暂停执行。
  本次只更新计划与恢复文档，未新增业务代码或 Git 提交。

## 当前后续步骤

第一切片按 `docs/superpowers/plans/2026-10-20-verified-learning-core.md`
完成复核。第二阶段来源/先修验证和课程确认 UI 的实施计划已保存为
`docs/superpowers/plans/2026-10-20-verified-learning-curriculum.md`（暂停，不直接执行）。
融合设计见 `docs/superpowers/specs/2026-10-20-complete-learning-experience-design.md`（用户已确认，语言含 Python 3/JavaScript/C）。
新实施总入口为 `docs/superpowers/plans/2026-10-21-complete-learning-experience.md`。用户后续要求今天后端优先，
已实现后端并将API/实际限制写入 `docs/verified-learning/frontend-handoff.md` 与 `backend-status.md`；
前端和真实判题部署后置，未把原18任务全部标完成；
用户已选择把编程自动判题并入本轮，实际 Linux 隔离环境验收仍待准备；
第三阶段增加题库验证、隔离 JudgePort、证据和复习。
认证路由、jobs、富课件、连接器、评审体验和模型评测另行验收。
不在本切片内将主线 Agent 接口包装成已经实现的增强业务。
