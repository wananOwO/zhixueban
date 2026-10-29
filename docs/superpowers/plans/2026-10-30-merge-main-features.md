# 合并 main：旧架构功能移植到新架构

**目标：** main 上的 8 个提交（7 个功能提交 + 1 个存档 81c098c）按新架构重做，再合并到 main，推送到新建的私有仓库 `wananOwO/zhixueban`（只推 main）。

**原则：** 以 feat/verified-learning 的代码为准；旧代码只作需求来源，不复制旧的 db/agent/lesson-view。每阶段先写失败测试，tsc、lint、全量测试通过才进下一阶段。界面沿用朱批本设计令牌，不新增风格。

## 功能对照

| main 功能 | 新分支现状 | 移植做法 |
|---|---|---|
| 纯 JS 解析 MOBI/AZW3（ebdfc66） | 依赖 calibre，没装就报错 | 搬 `parsers/mobi.ts` 与测试，`parse.ts` 改为内置解析 |
| 笔记导出 Markdown（4ba13a7） | 已有下载导出 | 补 frontmatter（知识点、课程、导出时间、来源） |
| 笔记写入本地 vault（4ba13a7） | 无 | 本地模式：设置页填 vault 路径，导出写入 `<vault>/智学伴/<课程>/<知识点>.md`；线上模式不可用 |
| Obsidian vault 导入（4ba13a7） | 无 | 教材库上传 vault zip → 作为一份「Obsidian 笔记」资料（每个 .md 一章），Agent 用 read/search 工具读取并引用。不做向量库：新架构用工具检索，引用要有段号 |
| MCP 只读工具（dcfb0b8） | 无 | 设置页配置 MCP server（名称 + URL）；Agent 生成与助教挂只读工具（写类工具名过滤）；连接失败降级并写进执行记录；调用记进轨迹，书带/执行记录可见 |
| Agent 活动面板（dcfb0b8） | 已有执行记录 + 书带 | 不移植，已被取代 |
| 设置四区 + 提示词 CRUD（56c563a） | 已有模型设置；课程模板（提示词）后端已有 | 设置页加「MCP」「Obsidian」两区；提示词模板管理放在设置页一个分区（接现有 /templates） |
| DEMO_MODE 只读（c5dcd97） | 线上模式已禁止改服务器设置，空间隔离 | 不单独移植：线上模式覆盖。MCP 配置在线上模式只读，取自环境变量 `VL_MCP_SERVERS` |
| 配置 WebUI 可编辑、DB 优先（ac6f0a9） | 已有 | 补 `judge0_url` 网页可配（本地模式），env 兜底 |
| 设置页拉取模型、首次配置提示、统一导航（81c098c） | 拉取模型、顶栏已有 | 首页在本地模式未配 Key 时显示「先去设置」提示 |
| Dockerfile + compose + README + 技术文档 + 视频脚本（8fd4546） | deploy/ 用 systemd+Nginx | README 按新架构重写（复现步骤、架构、功能）；技术文档、视频脚本按新功能改写；Dockerfile 改为可选部署方式写进 deploy/（compose 不含 Judge0，Judge0 用 deploy/judge0） |
| 依赖 echarts、@xyflow/react、tiptap、sqlite-vec、next-themes | 新前端不用 | 不加。`@ai-sdk/mcp` 随 MCP 加入 |
| dev-server.log、tsconfig.tsbuildinfo 被追踪 | — | 合并时删除并加入 .gitignore |

## 阶段

1. **MOBI 纯 JS 解析** → 验证：mobi 测试通过；上传 .mobi 不再要求 calibre。约 30 分钟。
2. **笔记导出 frontmatter + 本地 vault 写入** → 验证：导出内容带 frontmatter；路径无效时明确报错；线上模式 403。约 1 小时。
3. **Obsidian vault zip 导入为资料** → 验证：zip 内 .md 成章、可在教材详情阅读、可被课程选用与引用；zip 炸弹与路径穿越拒绝；只取 .md。约 2 小时。
4. **MCP 只读工具** → 验证：写类工具过滤；不可达 server 降级不阻塞；地址走公网校验（线上）；调用出现在轨迹；Agent 与助教都能用。约 3 小时。
5. **设置页：MCP、Obsidian、模板、判题地址分区 + 首页未配置提示** → 验证：e2e 与 a11y 通过，inspect 0 FAIL。约 2 小时。
6. **文档：README、技术文档、视频脚本、deploy/Dockerfile** → 验证：按 README 从零复现一遍。约 1.5 小时。
7. **合并到 main**：`git merge` 解决冲突时一律取新架构，删掉旧文件；跑全量 tsc/lint/test/build/e2e → 提交合并。约 30 分钟。
8. **新建私有仓库并推送 main**：`gh repo create wananOwO/zhixueban --private`，推送前再扫一次密钥。约 5 分钟。

合计约 1.5 个工作日（12 小时左右）。

**用户决定（2026-10-30）：** 缩小范围，本次只做阶段 1、2、6、7、8。阶段 3（Obsidian 导入）、4（MCP）、5（设置页 MCP/Obsidian/模板分区）延后；本次设置页只加阶段 2 需要的 vault 路径。main 上的 MCP 与 Obsidian 旧代码保留在 git 历史里（提交 4ba13a7、dcfb0b8）。

## 风险

- MCP 与 Obsidian 是新增攻击面：MCP URL 走 `assertPublicUrl`（线上），vault zip 限制解压后总大小与文件数，拒绝 `..` 路径。
- 合并时 package.json、pnpm-lock.yaml 冲突：以新分支为基础，只加 `@ai-sdk/mcp`，重新 `pnpm install` 生成锁文件。
