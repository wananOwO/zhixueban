# 智学伴：面向长教材与编程学习的可验证 AI 学习助手

> 2026 第九届传智杯 · AI WEB 网页开发挑战赛参赛作品 · 选手：覃浩东（wananOwO）

导入一本几百页的长教材，写下明确的学习目标（如「备战蓝桥杯 Python 组」）。智学伴通过工具驱动的生成 Agent 规划先修路线，基于 **SQLite 关键词 + Embedding 混合 RAG** 检索原书，逐节撰写带段落级出处的课件、生成经独立审校与 Judge0 隔离验证的练习题，并支持**题目截图 / 代码截图多模态闭环**；是否真正学会，由独立作答证据判定。

## 核心能力

- **目标驱动的课程编译**：Agent 只挑选与目标相关的知识点并补齐必需先修，经 `compileCurriculum` 静态检查成环、缺源、顺序违背等问题，人工审核路线图后才激活课程。教材缺失知识点可联网拉取公开资料并固化为不可变快照。
- **SQLite 混合 RAG 与可解释出处**：在不可变来源快照（`vl_source_revisions`）之上按句界建立带重叠的派生检索块与 Float32 向量索引，通过加权 RRF（`0.5/(60+keywordRank)+0.5/(60+vectorRank)`）融合中文二元组/代码符号词法召回与语义向量召回。每处结论展示**来源、章节、真实段号与关键词/语义/章节加权标签**，点击朱批旁注或出处详情即可打开原书定位核对；未配置或服务故障时自动无缝降级关键词检索。
- **题目截图 / 代码截图多模态闭环**：学习页助教支持粘贴、拖拽或选择 PNG/JPEG/WebP 截图。服务端经带 1600 万像素上限的 `sharp` 解码器重编码并彻底剥离 EXIF 隐私元信息后，调用视觉模型（OpenAI 兼容或 Anthropic）提取结构化题面与代码；经用户编辑确认后进入课程混合检索、流式出处讲解与 **1 道同考点变式练习**（`vision_practice` 走完整引用与独立审校，但不推进主课程进度、不污染独立掌握证据，原图绝不落盘）。
- **工具验收驱动的生成与断点续跑**：所有课程方案、课件小节、题目与审校结论均通过 Function Calling 工具提交，提交时立即核验 Schema 与 `checkCitation` 原文包含关系；失败原因反馈 Agent 自动修正，任务中断后可从 `vl_agent_states` 检查点续跑，已完成部分不重复计费。「书带（Tape）」直观展示 Agent 读过的段落区间与最终采用的出处。
- **出题独立审校与 Judge0 隔离判题**：选择题、填空题与编程题均经引用校验、已学范围校验、重复题拦截与独立上下文审校；编程题参考解先在无网络隔离的 Judge0 沙箱跑通全部公开与隐藏用例后才发布。
- **区分「学过」与「学会」的掌握证据**：同一知识点至少答对 3 道不同题、最近 5 题正确率 ≥ 80% 且最近一题独立答对才判定掌握；查看第 4 级完整解析提示后的作答及截图变式练习均不计入独立掌握证据。
- **七种教材内置解析与笔记联动**：内置纯 JS 解析 TXT、Markdown、EPUB、PDF（文字层）、DOCX、MOBI、AZW3（无需安装 Calibre）；支持按知识点导出带 YAML frontmatter 的 Markdown 笔记，本地模式可直接写入本机 Obsidian Vault。

## 技术架构

```text
┌──────────────────────────────────────────────────────────────────────┐
│                              Web 前端                                │
│  教材库（语义索引面板） · 课程草稿 · 生成轨迹（书带） · 学习页（朱批） │
│  流式助教 · 截图提问（预览 / 编辑核对 / 出处详情 / 1 题变式练习）      │
└──────────────────┬─────────────────────────────────┬─────────────────┘
                   │                                 │
                   ▼                                 ▼
┌─────────────────────────────────┐ ┌──────────────────────────────────┐
│     Verified Learning API       │ │        Tutor & Vision API        │
│  教材、课程编译、任务流、判题    │ │  图像重编码脱敏、结构化识图、讲解  │
└──────────────────┬──────────────┘ └────────────────┬─────────────────┘
                   │                                 │
                   ▼                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         统一混合检索层（RAG）                         │
│   空间与修订授权过滤 → 词法召回（标识符+中文二元组+章节加权）          │
│                    → 向量余弦召回 → RRF 融合重排 → checkCitation 复核 │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       SQLite（WAL · Schema v6）                      │
│  来源快照(不可变) · 派生块/向量/索引任务 · 课程/会话/作答 · Agent 状态 │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│             LLM / Embedding / Vision / 隔离 Judge0 沙箱              │
└──────────────────────────────────────────────────────────────────────┘
```

**技术栈**：Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS 4 · TanStack Query · Zustand · Vercel AI SDK · `pi-agent-core` · `better-sqlite3`（WAL）· `sharp` · Shiki · CodeMirror 6 · Judge0 · Vitest · Playwright + axe-core · Biome。

## 本地运行步骤（约 5–10 分钟）

环境要求：Node.js 22+、pnpm。聊天生成需要一个 OpenAI 兼容接口（DeepSeek、OpenAI、智谱、通义千问等）或 Anthropic 的 API Key；Embedding 与视觉模型均为可选增强（未配置时自动使用关键词检索与文字提问）。

```powershell
# 1. 安装依赖
pnpm install

# 2. 初始化本机 SQLite 数据库（Schema v6）
pnpm vl:init --db data/app.db --create

# 3. 生产构建并启动（默认免登录，仅监听 127.0.0.1:3101）
pnpm build
pnpm start
```

浏览器打开 http://127.0.0.1:3101 ，进入「设置」配置聊天模型（及可选的 Embedding 模型、视觉模型）：

1. 在「教材库」上传教材；如需语义检索，可在教材详情页点击「建立语义索引」（展示段落数、字数与供应商地址，确认后才调用）。
2. 在「课程草稿」填写学习目标、勾选章节并点击「生成课程方案」，审核先修路线图后确认建课。
3. 在「学习页」阅读带朱批出处的课件、完成练习题，或打开右侧助教体验「文字提问」与「截图提问」。

开发调试可运行 `pnpm dev`（或 `pwsh scripts/dev-local.ps1`）。

### 环境变量模板说明

本机默认无需 `.env.local` 即可运行。如需开启本机固定密码或接入 Judge0 判题，可在项目根目录新建 `.env.local`（已被 `.gitignore` 忽略，切勿将密钥写入 `NEXT_PUBLIC_*`）：

```dotenv
# 可选：数据库路径（默认位于 data/ 内）
DB_PATH=data/app.db

# 可选：开启本机访问密码（默认 VL_LOCAL_AUTH=0 免登录，仍保留同源 Host/Origin 校验）
VL_LOCAL_AUTH=0
# VL_LOCAL_PASSWORD="请替换为固定密码（1-128 字符，含 $ 写为 \$）"

# 可选：命令行离线评测或默认模型环境变量（网页设置页优先级更高）
# LLM_PROVIDER=openai-compatible
# LLM_BASE_URL=https://api.deepseek.com/v1
# LLM_MODEL=deepseek-chat
# LLM_API_KEY=sk-...
# EMBEDDING_BASE_URL=https://api.openai.com/v1
# EMBEDDING_MODEL=text-embedding-3-small
# EMBEDDING_API_KEY=sk-...

# 可选：编程题隔离判题服务（Judge0 仅运行在 Linux 容器内，未配置时仅禁用编程题）
# JUDGE0_URL=http://127.0.0.1:2358
# JUDGE0_TOKEN=...
```

公网线上部署环境变量模板见 [`deploy/env.example`](deploy/env.example)，完整 Nginx / systemd / Judge0 部署说明见 [`deploy/README.md`](deploy/README.md)。

## 公网模式与免 Key 示例课程说明

- **空间隔离与免 Key 体验**：公网模式（`VL_MODE=online`）采用访问码鉴权并按浏览器分配独立隔离空间（30 天闲置自动清理），新空间登录即自动复制一门预置示例课程。**体验者无需填写任何模型 Key**，即可直接浏览先修路线图、带朱批出处的课件回查、生成过程书带回放与练习题作答；如需在线测试新课生成、建立语义索引或截图提问，再在「设置」页填入自备 Key 即可。

## API Key 与多模态隐私安全说明

- **三路凭据隔离且不落盘**：线上模式下，浏览器配置保存在当前浏览器 `localStorage`，分别通过 `X-VL-Model`、`X-VL-Embedding`、`X-VL-Vision` 请求头按需传输（每项限长 8 KiB，强制校验公网 HTTPS/HTTP 地址并禁止重定向以防 SSRF）。服务器仅在请求或后台任务运行期间于进程内存持有凭据，任务结束立即清除，绝不写入数据库、WAL、检查点、事件流、示例导出或日志；设置页支持一键清除全部浏览器 Key。
- **截图脱敏与不持久化**：上传截图限制 PNG/JPEG/WebP、单张 ≤ 5 MiB、≤ 1600 万像素、最长边 ≤ 4096；服务端经 `sharp` 像素解码重编码剥离全部 EXIF/GPS/设备信息，原图与 base64 在请求结束后立即释放，绝不进入数据库或日志。
- **外部内容指令隔离**：教材正文、联网公开网页与截图识别文字一律作为不可信数据处理，引用必须通过 `checkCitation` 逐字核验。

## 测试与量化评测命令

```powershell
# 1. 单元、接口与组件测试（Vitest）
pnpm test

# 2. TypeScript 全量严格类型检查
pnpm exec tsc --noEmit --incremental false

# 3. 代码规范检查（Biome）
pnpm lint

# 4. 检索离线评测（A 关键词 / B 纯向量 / C 混合+章节过滤 + 5000×1536 本地时延基准）
pnpm eval:retrieval -- --fixture tests/fixtures/retrieval/test.json --out data/eval/retrieval.json

# 5. 生成验收、学习掌握闭环与免 Key 示例课程离线评测
pnpm eval:learning -- --out data/eval/learning.json

# 6. 端到端与 WCAG 无障碍扫描（Playwright + axe-core）
$env:CI = '1'; pnpm test:e2e

# 7. 生产构建与字节级密钥不落盘扫描
pnpm build
pnpm exec tsx scripts/check-key-leak.ts --key <待检测试密钥> data
```

评测结果输出在被 Git 忽略的 `data/eval/` 目录（JSON 与 Markdown 双格式），不读写用户生产数据。

## 目录结构

```text
src/app/                              App Router 页面与唯一后端入口 api/verified-learning/v1
src/components/                       纸面/朱批 UI、教材语义索引面板、多模态截图助教、书带与路线图
src/lib/verified-learning/            核心业务：教材库、课程编译、学习调度、掌握证据、Judge0、安全访问
src/lib/verified-learning/retrieval/  SQLite 混合 RAG：句界重叠分块、Float32 向量、RRF 检索、任务与评测
src/lib/verified-learning/vision/     多模态闭环：像素限额解码与 EXIF 剥离、多协议识图、并发幂等协调
src/lib/verified-learning/evaluation/ 生成验收、学习掌握与工程可用性量化评测
src/lib/verified-learning/agent/      工具驱动 Agent：资料检索工具、网页拉取、状态日志与连接工厂
src/lib/textbook/                     七种格式内置解析（含纯 JS PalmDOC MOBI/AZW3 解析）
tests/                                Vitest 单元/集成测试、检索评测集 fixtures、Playwright E2E 与无障碍测试
scripts/                              数据库初始化、示例导出、检索/学习评测 CLI、字节级 Key 泄漏扫描
deploy/                               公网部署：Nginx（SSE 与多头缓冲）、systemd 加固、Judge0 隔离编排
```

## 开源依赖与原创声明

### 开源依赖
本项目基于开源生态构建，主要包括 Next.js、React、Tailwind CSS、TanStack Query、Zustand、Vercel AI SDK、`@earendil-works/pi-agent-core`、`better-sqlite3`、`sharp`、`pdfjs-dist`、`mammoth`、`jszip`、Shiki、CodeMirror 6、Radix UI、Judge0 CE（独立容器服务）以及 Vitest、Playwright、axe-core、Biome，各依赖均遵循其对应开源许可证（MIT / Apache-2.0 / ISC / GPL 等）。固定评测语料采用本仓库原创 CC0-1.0 重述文本。

### 原创声明
「智学伴」的产品架构设计、可验证课程编译器、工具校验驱动的生成与独立审校闭环、SQLite 混合 RAG 与段落级朱批回查机制、题目/代码截图多模态学习闭环、掌握证据判定算法及全部前后端业务源码均由参赛团队独立原创设计与实现，不存在抄袭或侵犯第三方知识产权的行为。
