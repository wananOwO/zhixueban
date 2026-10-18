# 并行分支协作说明

## 当前状态

| 项目 | 值 |
|---|---|
| 主线分支 | feat/mvp |
| 主线目录 | E:/code/程序设计比赛 |
| 增强分支 | feat/verified-learning |
| 增强目录 | E:/code/程序设计比赛-verified-learning |
| 初始分叉提交 | 094eda4 |
| 本次最后同步的主线提交 | 4949471 |
| 基线检查 | pnpm install --frozen-lockfile；pnpm test，8 个测试文件、25 项测试通过；pnpm build 通过 |
| 本轮新增内容 | 设计规格、接口契约和本协作说明 |
| 业务开发状态 | 等待书面规格复核，未改业务代码 |

仓库当前没有配置远程地址。本文描述本机分支协作，不表示已经推送远程。
桌面 worktree 工具未识别会话绑定的映射路径，因此使用 Git 原生 worktree；
两个目录已由 git worktree list 验证，主线仍在 feat/mvp。

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
当前契约已按 4949471 的真实代码核对，但尚未由另一个 agent 共同确认。
不把“写了契约”描述为两条开发线已经建立自动同步。
提交本轮文档后，主线可用以下只读命令查看契约，无需切换自己的分支：

```text
git show feat/verified-learning:docs/contracts/verified-learning-v1.md
```

每个可交付切片开始前：

1. 在增强 worktree 检查自身状态和 feat/mvp 的最新已提交内容。
2. 工作区干净后，选择明确的主线提交进行合并，不读取半成品替代提交。
3. 检查教材 API、共享类型、schema、provider 和依赖锁文件的变化。
4. 更新本文件中的对齐提交和契约差异。
5. 执行原测试与新增契约测试，再继续业务开发。

仅在增强 worktree 操作的同步命令形式：

```text
git status --short --branch
git log --oneline HEAD..feat/mvp
git diff HEAD...feat/mvp -- src/lib/db src/lib/textbook src/lib/rag src/lib/llm src/app/api package.json pnpm-lock.yaml
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

## 当前后续步骤

用户复核 `docs/superpowers/specs/2026-10-19-verified-learning-design.md`。
通过后为“契约与学习状态核心”编写独立实现计划，再进入测试驱动开发。
原计划其余子系统不会在没有分阶段验收的情况下整体启动。
