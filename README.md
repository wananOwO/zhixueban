# 智学伴：讲解句句有出处的 AI 学习助手

> 2026 第九届传智杯 · AI WEB 网页开发挑战赛参赛作品 · 选手：覃浩东（wananOwO）

导入一本教材，写下学习目标。Agent 读完教材后排出一条先修路线，再一节节写课件、出题、批改。课件里每一句讲解都标明出自原书第几段，点一下就能对照原文。是否学会，要靠你独立答对不同的题来证明。

## 能做什么

- **按目标重排教材**：例如目标是「蓝桥杯 Python 组」，Agent 只挑与目标相关的知识点，补齐缺少的先修，画成路线图让你审核。教材里缺的内容会联网找公开资料补充，同样标注来源。
- **讲解有出处**：课件右侧是朱批旁注，被引用的那一句原文下面画线；点旁注就打开原书并定位到对应段落。
- **生成过程可回看**：生成时实时显示 Agent 读了哪几段、搜了什么、哪次提交没通过校验又改了；「书带」把读过的段落和最终采用的出处画在全书长度上。
- **出题先校验**：每道题都经过引用、范围、答案一致性和独立模型审校；编程题的参考解先在隔离的 Judge0 里跑通，才会发给你。
- **掌握靠证据**：同一个知识点至少答对 3 道不同的题，最近 5 题正确率不低于 80%，且最近一题答对，才算掌握。看过完整解析（第 4 级提示）后的作答不计入。
- **助教**：针对当前课件提问，回答同样标注出处；你还在做题时，助教不会直接给出答案。
- **教材格式**：TXT、Markdown、EPUB、PDF（需有文字层）、DOCX、MOBI、AZW3，全部用内置解析，不需要安装 calibre。
- **笔记**：按知识点记笔记，可导出带 frontmatter 的 Markdown；本地部署时还能直接写入本机的 Obsidian vault。

## 本地运行（约 10 分钟）

需要 Node 22 以上和 pnpm，以及一个 OpenAI 兼容接口（DeepSeek、OpenAI、智谱等）或 Anthropic 的 API Key。

```powershell
# 1. 安装依赖
pnpm install

# 2. 新建本机数据库
pnpm vl:init --db data/app.db --create

# 3. 构建并启动（默认免登录，只监听 127.0.0.1:3101）
pnpm build
pnpm start
```

打开 http://127.0.0.1:3101 ，默认直接进入应用。进入「设置」填写模型供应商、API Key 和模型名，然后：

1. 在「教材库」上传一本教材。
2. 在「课程草稿」写下学习目标，选章节，点「生成课程方案」。
3. 生成完成后审核路线图，确认后开始学习。

开发时运行 `pnpm dev`；Windows 也可以用 `pwsh scripts/dev-local.ps1` 在后台启动。两种启动方式均读取项目根目录 `.env.local`，不会每次生成新密码。

### 可选：开启本机固定密码

默认不需要配置认证。需要密码时，在项目根目录的 `.env.local` 添加：

```dotenv
VL_LOCAL_AUTH=1
VL_LOCAL_PASSWORD="你自己设置的固定密码"
# 可选：使用其他已初始化数据库
DB_PATH=data/app.db
```

修改后重启服务，无需重新构建。关闭密码设为 `VL_LOCAL_AUTH=0`；开启后密码为空、全空白或超过 128 字符会明确报错，不会自动放行。密码精确匹配，包含 `$` 时在配置中写为 `\$`。`.env.local` 已被 Git 忽略，不要把密码写进 `NEXT_PUBLIC_*` 变量。

本地免登录仍保留 Host、Origin 与跨站请求校验，但这台电脑上能访问服务的用户都能操作数据。不要把免登录的本机服务通过代理暴露到公网；公网部署继续使用下方的线上访问码模式。旧的 `VERIFIED_LEARNING_LOCAL`、`VERIFIED_LEARNING_ACCESS_TOKEN` 已不再使用。

**编程题（可选）**：需要 Judge0。Judge0 只能在 Linux 上运行，部署方法见 `deploy/README.md`。设置环境变量 `JUDGE0_URL`（以及 `JUDGE0_TOKEN`）后，设置页会显示可用语言（Python、JavaScript、C）。没有 Judge0 时只是不生成编程题，选择题和填空题不受影响；程序不会在主机上直接执行学生代码。

## 线上部署

同一份代码设置 `VL_MODE=online` 即为公网模式：访问码登录，每个浏览器一个独立空间；评委的模型 Key 只保存在自己的浏览器里，服务器只在内存中使用，任务结束即删除，不写数据库和日志。新空间会自动带上一门示例课程，不填 Key 也能浏览和答题。

Nginx、systemd、Judge0 的配置、示例课程的制作与运维步骤见 [`deploy/README.md`](deploy/README.md)。

## 测试

```powershell
pnpm test                                   # 单元与接口测试（Vitest）
pnpm exec tsc --noEmit --incremental false  # 类型检查
pnpm lint                                   # Biome
$env:CI = '1'; pnpm test:e2e                # 端到端与无障碍（Playwright，会先做一次生产构建）
```

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS 4 · TanStack Query · Vercel AI SDK（流式助教）· pi-agent-core（工具驱动的生成 Agent）· better-sqlite3（WAL）· shiki · CodeMirror · Judge0 · Vitest · Playwright + axe

## 架构

```
上传教材 ─► 解析为章节与段落（每段有稳定段号） ─► 来源快照
                                                   │
写下目标 ─► 课程草稿 ─► Agent 生成课程方案 ──────────┤  工具：list/search/read_source、
                         （读原文、联网补充、          │        search_web、fetch_web_source、
                          逐个提交并校验知识点）       │        submit_*、finish_generation
                                 │                    │
                         审核路线图并确认 ─► 正式课程   │
                                 │                    │
            学习会话 ─► Agent 写课件 / 出题（引用校验 + 独立审校 + Judge0 跑参考解）
                                 │
               作答 ─► 本地比对 / Judge0 判分 ─► 掌握证据 ─► 下一步
```

- 所有生成都通过工具调用提交，每次提交先过校验；校验失败时 Agent 收到原因再改，通过了才保存。不解析模型的普通文字回复。
- 生成任务可断点续跑：已通过验收的知识点、小节、题目不会重复生成。
- 安全：严格 CSP（nonce）、同源校验、HttpOnly Cookie；联网资料与线上模式的模型地址只允许公网地址，并逐跳校验重定向。

## 目录

```
src/app/                         页面与唯一的 API 入口 api/verified-learning/v1
src/components/                  界面组件（zhupi/ 为朱批、书带、路线图等标志组件）
src/lib/verified-learning/       后端：教材库、课程、学习、判题、记录、访问控制
src/lib/verified-learning/agent/ 生成 Agent：工具、会话日志、模型连接
src/lib/textbook/                教材解析（含纯 JS 的 MOBI/AZW3 解析）
prompts/subjects/                六类学科提示词
deploy/                          线上部署配置与运维说明
tests/                           Vitest 与 Playwright 测试
```
