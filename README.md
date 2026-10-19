# 智学伴 — 目标驱动的 Agent 个性化学习平台

> 2026 第九届传智杯 · AI WEB 网页开发挑战赛参赛作品

导入一本教材，告诉 AI 你想学什么、想怎么学，它为你裁剪课程、逐节讲解、出题考验，直到你真的学会。

## 核心特性

- **目标驱动课程重组**：输入学习目标（如"只学语法和算法"）+ 基础描述，Agent 按先修依赖裁剪重排教材知识图谱，生成个性化课程；教材缺口自动检测并明示
- **三种学习模式**：理论学习 / 边学边练 / 刷题模式，学习中途可切换，记录全保留
- **生成—校验—发布的出题**：独立校验器核实参考解法的实际知识依赖，编程题经执行器跑通参考解才入库；题目严格限于已学内容
- **判题分工**：客观题本地比对、编程题执行器（Judge0/node:vm）判对错、LLM 只解释错误并给四级分层提示
- **教材为中心但不锁死**：RAG 锚点防幻觉，模型可补充教材外内容；引用处标注来源徽标可跳回原文
- **学科专家提示词**：内置计算机/数学/物理/生物/语言/通用 6 类，支持自定义
- **MCP 只读工具接入**：Agent 可检索最新技术资料，调用过程可视化
- **学习画像**：掌握度热力图、知识图谱着色、Obsidian 导入导出

## 10 分钟极速复现

```bash
# 1. 克隆与安装（需 Node ≥ 22 + pnpm）
git clone <repo-url> && cd 程序设计比赛
pnpm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入 LLM_API_KEY（DeepSeek 等 OpenAI 兼容接口即可）

# 3. 启动
pnpm dev
# 打开 http://localhost:3000

# 4. 跑测试（80+ 用例）
pnpm test
```

## 技术栈

Next.js 16（App Router）· TypeScript · Vercel AI SDK · better-sqlite3 + sqlite-vec ·
Tailwind CSS v4 · ECharts · React Flow · TipTap · Judge0（可选）

## 架构

```
教材解析（TXT/MD/EPUB/PDF/DOCX/MOBI）→ 统一章节树 → 分块 + sqlite-vec 向量库
     ↓
知识图谱（工具调用注册知识点 + 先修依赖，拒绝成环）
     ↓
目标驱动编课（学习约定 → 裁剪/重排/缺口检测 → 四清单确认页）
     ↓
流式课件（RAG 锚点 + 学科提示词 + MCP 资料）→ 三模式学习状态机
     ↓
出题（生成—校验—发布）→ 判题（执行器为主）→ 掌握度模型 → 学习画像
```

## 项目结构

```
src/lib/textbook/   教材解析与分块
src/lib/rag/        向量库检索
src/lib/agent/      知识图谱 / 编课 / 课件 / 出题 / 校验 / 判题 / 掌握度 / 状态机
src/lib/mcp/        MCP 只读工具客户端
src/lib/obsidian/   vault 导入导出
src/app/            页面与 API
prompts/subjects/   内置学科提示词
```

## 参赛信息

选手：覃浩东（wananOwO）· 个人参赛
