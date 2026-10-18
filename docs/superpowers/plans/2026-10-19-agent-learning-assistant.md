# 智学伴（Agent 个性化学习平台）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个单用户本地优先的 Web 应用：导入多格式教材 → 按学习目标生成个性化课程 → 三种模式学习并出题考验 → 掌握度可视化。

**Architecture:** Next.js 14 App Router 单仓库全栈。教材解析为统一章节树 → 分块入 sqlite-vec 向量库 + Agent 生成知识图谱 → 目标驱动裁剪重排出课程大纲 → 逐知识点流式生成课件。出题/判题/掌握度闭环。Obsidian 与 MCP 为可选外挂。

**Tech Stack:** Next.js 14+ / TypeScript strict / Vercel AI SDK / better-sqlite3 + sqlite-vec / Tailwind + shadcn/ui / ECharts / Vitest / pnpm

**Spec:** `docs/superpowers/specs/2026-10-19-agent-learning-assistant-design.md`

## Global Constraints

- Node ≥ 20，包管理器 pnpm，TypeScript `strict: true`
- LLM/Embedding 的 API Key、baseURL 全部走环境变量（`.env.local` 模板入库，真实值不入库）
- 所有 LLM 调用必须经 `src/lib/llm/provider.ts` 的 `getModel()` / `getEmbeddingModel()`，禁止散落直连
- **结构化生成一律用工具调用（tool calling）规范**：模型必须调用注册类工具（如 `register_knowledge_point`、`submit_question`）提交格式化内容，不用裸提示词约束的 `generateObject`——指令遵守差的模型也会被工具 schema 强制约束
- 教材支持格式：EPUB、TXT、PDF、MOBI、AZW3、DOCX、Markdown（MOBI/AZW3 走 calibre 可选依赖，见设计 §5.1）
- 出题硬约束：题目仅能使用「已解锁知识点」内容可解（设计 §5.3）
- 提交截止 2026-11-18；Git 提交保持细粒度，每任务至少一个 commit
- 严禁照搬任何开源项目代码（赛道违规条款）；但允许使用成熟开源组件库并以其为基底二改（见设计 §4.1）
- UI 组件优先复用开源：shadcn/ui、assistant-ui、TipTap、@xyflow/react、cmdk、react-resizable-panels；不重复造轮子
- 无障碍：键盘可达、对比度 ≥ WCAG AA、流式区 aria-live、prefers-reduced-motion（见设计 §4.1）

## Review Focus

1. **扫描版 PDF 无文本层**：解析结果应为空章节树 + 明确错误"该 PDF 无文本层，请换 OCR 版"，而非静默生成空课程 → Task 4 测试覆盖。
2. **无章节标记的 TXT**（通篇无"第X章/一、"等）：降级为按固定长度切分的伪章节，不抛异常 → Task 2 测试覆盖。
3. **首知识点出题**：`unlockedKPIds` 仅含当前知识点时，题目不得引用后续章节内容 → Task 12 测试覆盖。
4. **API Key 缺失或错误**：任何生成入口须返回可读中文错误（"请先在设置页配置 LLM API Key"），不得裸 500 → Task 6 测试覆盖。
5. **Obsidian vault 路径无效/无写权限**：同步失败降级为仅应用内笔记并提示一次，不阻塞学习流程 → Task 16 测试覆盖。

---

## 文件结构总览

```
src/lib/textbook/    教材解析（types, parse, parsers/*, chunk）
src/lib/rag/         向量库与检索（store, retrieve）
src/lib/llm/         provider 工厂、提示词加载（provider, prompts）
src/lib/agent/       knowledge-graph, course-composer, lesson-writer,
                     question-gen, judge, mastery, subject-prompts
src/lib/mcp/         MCP client 封装（client）
src/lib/obsidian/    vault 双向同步（sync）
src/lib/db/          schema, index（better-sqlite3）
src/app/             页面与 API routes
prompts/subjects/    内置学科专家提示词（6 个 .md）
tests/               与 src 镜像
```

数据模型按设计 §6 建表（Textbook/Chunk/KnowledgePoint/KnowledgeEdge/Course/Lesson/Question/Attempt/Note/PromptTemplate/Settings），在 Task 1 一次性建好。

---

### Task 1: 项目脚手架 + 数据库层

**Files:**
- Create: `package.json`（create-next-app 初始化）、`src/lib/db/schema.ts`、`src/lib/db/index.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: `getDb(): Database`（better-sqlite3 单例，自动建表）；表结构按设计 §6 全部 11 张表

- [ ] **Step 1: 写失败测试**

```ts
// tests/db/schema.test.ts
test('建库后 11 张表存在且可插入', () => {
  const db = getDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(
    ['textbooks','chunks','knowledge_points','knowledge_edges','courses',
     'lessons','questions','attempts','notes','prompt_templates','settings']));
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm vitest run tests/db/schema.test.ts`，预期模块不存在
- [ ] **Step 3: 实现** `getDb(path?: string)`：better-sqlite3 单例，建表 SQL 按设计 §6 字段
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `chore: 脚手架与数据库 schema`

### Task 2: 章节树类型 + TXT/Markdown 解析器

**Files:**
- Create: `src/lib/textbook/types.ts`、`src/lib/textbook/parsers/txt.ts`、`src/lib/textbook/parsers/markdown.ts`
- Test: `tests/textbook/txt.test.ts`、`tests/textbook/markdown.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Paragraph { text: string; anchor: { chapterId: string; index: number } }
  interface Chapter { id: string; title: string; level: number; paragraphs: Paragraph[] }
  interface ChapterTree { title: string; format: BookFormat; chapters: Chapter[] }
  type BookFormat = 'txt'|'md'|'epub'|'pdf'|'docx'|'mobi'|'azw3';
  parseTxt(content: string, title: string): ChapterTree
  parseMarkdown(content: string, title: string): ChapterTree
  ```

- [ ] **Step 1: 写失败测试**：含「有章节标记的 TXT 正常分章」和「无标记 TXT 降级为每 2000 字伪章节」两条；MD 按 `#` 层级分章
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** 两个解析器；TXT 章节正则：`/^第[一二三四五六七八九十\d]+[章节篇]/m` 与 `/^\d+(\.\d+)*\s/` 两级探测
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: TXT/Markdown 教材解析`

### Task 3: EPUB 与 DOCX 解析器

**Files:**
- Create: `src/lib/textbook/parsers/epub.ts`、`src/lib/textbook/parsers/docx.ts`
- Test: `tests/textbook/epub.test.ts`（自带一个最小 fixture epub）

**Interfaces:**
- Consumes: Task 2 的 `ChapterTree` 类型
- Produces: `parseEpub(buf: Buffer, title: string): Promise<ChapterTree>`、`parseDocx(buf: Buffer, title: string): Promise<ChapterTree>`（图片抽存到 `data/assets/`，段落记 `images?: string[]`）

- [ ] **Step 1: 写失败测试**：fixture epub → 章节数、标题层级、anchor 递增正确
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：EPUB 用 `epub2` 或自解析 zip+opf spine 顺序；DOCX 用 `mammoth` 转 HTML 后按 h1-h3 分章
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: EPUB/DOCX 教材解析`

### Task 4: PDF 解析器（含无文本层检测）

**Files:**
- Create: `src/lib/textbook/parsers/pdf.ts`
- Test: `tests/textbook/pdf.test.ts`

**Interfaces:**
- Consumes: `ChapterTree`
- Produces: `parsePdf(buf: Buffer, title: string): Promise<ChapterTree>`；无文本层时 throw `PdfNoTextLayerError`

- [ ] **Step 1: 写失败测试**：正常 PDF 按大纲/字号启发式分章；无文本层 fixture → 抛出 `PdfNoTextLayerError`（Review Focus #1）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：`pdfjs-dist` 抽文本与字体大小，大字号行聚类为章节标题；全书文本 < 100 字符判定无文本层
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: PDF 教材解析`

### Task 5: 统一入口 + 分块 + 向量库

**Files:**
- Create: `src/lib/textbook/parse.ts`、`src/lib/textbook/chunk.ts`、`src/lib/rag/store.ts`、`src/lib/rag/retrieve.ts`
- Test: `tests/textbook/chunk.test.ts`、`tests/rag/store.test.ts`

**Interfaces:**
- Consumes: 各 parser
- Produces:
  ```ts
  parseTextbook(filePath: string): Promise<ChapterTree>   // 按扩展名分发；mobi/azw3 调 calibre 转换
  chunkChapterTree(tree: ChapterTree): Chunk[]            // 约 500 字/块，保留 anchor
  upsertChunks(textbookId: string, chunks: Chunk[], embeddings: number[][]): void
  searchChunks(textbookId: string, queryEmbedding: number[], k: number): ScoredChunk[]
  ```

- [ ] **Step 1: 写失败测试**：分块长度约束 + anchor 不丢失；sqlite-vec 插入 3 条后最近邻检索返回正确顺序
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：分块按段落聚合不超 500 字；`store.ts` 用 sqlite-vec 虚拟表；MOBI/AZW3 检测 calibre `ebook-convert`，缺失则报错提示安装
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: 解析统一入口与向量库`

### Task 6: LLM Provider 工厂 + 提示词加载

**Files:**
- Create: `src/lib/llm/provider.ts`、`src/lib/llm/prompts.ts`、`prompts/subjects/{computer,math,physics,biology,language,general}.md`
- Test: `tests/llm/provider.test.ts`

**Interfaces:**
- Produces:
  ```ts
  getModel(): LanguageModel            // 读 env: LLM_PROVIDER/LLM_MODEL/LLM_BASE_URL/LLM_API_KEY
  getEmbeddingModel(): EmbeddingModel
  class MissingApiKeyError extends Error  // message 为中文配置指引（Review Focus #4）
  loadSubjectPrompt(subjectType: string): string   // 读 prompts/subjects/*.md，未知类型回退 general
  ```

- [ ] **Step 1: 写失败测试**：env 缺失时 `getModel()` 抛 `MissingApiKeyError`；`loadSubjectPrompt('math')` 非空、`loadSubjectPrompt('unknown')` 回退 general
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：`@ai-sdk/openai-compatible` 统一接入（OpenAI/DeepSeek/智谱均兼容），Anthropic 走 `@ai-sdk/anthropic` 分支；6 个学科提示词按设计 §5.4 风格要求编写
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: LLM provider 工厂与学科提示词`

### Task 7: 教材导入 API + 上传页

**Files:**
- Create: `src/app/api/textbooks/route.ts`、`src/app/textbooks/page.tsx`、`src/app/textbooks/import-form.tsx`
- Test: `tests/api/textbooks.test.ts`（route handler 单测）

**Interfaces:**
- Consumes: Task 5 `parseTextbook` / `chunkChapterTree` / `upsertChunks`，Task 6 `getEmbeddingModel`
- Produces: `POST /api/textbooks`（multipart 上传 → 解析 → 分块 → embedding → 入库，返回 `{ textbookId, chapterCount }`）

- [ ] **Step 1: 写失败测试**：上传 fixture txt → 200 且数据库有记录；非法扩展名 → 400 中文错误
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** route + 上传页（拖拽、解析进度、PdfNoTextLayerError 的中文提示展示）
- [ ] **Step 4: 运行确认通过 + 页面手动验证**（`pnpm dev` 上传一本 txt）
- [ ] **Step 5: Commit** — `feat: 教材导入 API 与上传页`

### Task 8: 知识图谱生成

**Files:**
- Create: `src/lib/agent/knowledge-graph.ts`
- Test: `tests/agent/knowledge-graph.test.ts`（mock LLM）

**Interfaces:**
- Consumes: `ChapterTree`、`getModel`
- Produces:
  ```ts
  generateKnowledgeGraph(textbookId: string): Promise<KnowledgeGraph>
  // 逐章让 LLM 抽知识点+前置依赖，generateObject 结构化输出，落库 knowledge_points/knowledge_edges
  interface KnowledgeGraph { points: KnowledgePoint[]; edges: { fromId: string; toId: string }[] }
  ```

- [ ] **Step 1: 写失败测试**：mock model 返回固定 JSON → 库中知识点与依赖边正确；环依赖检测后拒绝成环
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：`generateObject` + zod schema；拓扑排序校验
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: 知识图谱生成`

### Task 9: 目标驱动课程生成

**Files:**
- Create: `src/lib/agent/course-composer.ts`
- Test: `tests/agent/course-composer.test.ts`（mock LLM）

**Interfaces:**
- Consumes: Task 8 `KnowledgeGraph`、`loadSubjectPrompt`
- Produces:
  ```ts
  composeCourse(input: { textbookId: string; goal: string; goalPrompt: string;
    subjectType: string; mode: 1|2|3 }): Promise<Course>
  // 裁剪无关子树、按依赖拓扑重排、标注深浅；落库 courses.outlineJson
  ```

- [ ] **Step 1: 写失败测试**：目标"只学语法和算法"时，mock 裁剪结果不含被排除子树；大纲节点顺序满足前置依赖；**教材缺口**：mock 目标含"算法"但图谱无算法知识点时，输出 `gaps` 字段非空
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：图谱 + 目标 + 学科提示词注入 → `generateObject` 输出大纲与 gaps；**裁剪以知识点为单位**（被排除章节中首次出现的必要知识点提取保留）；本地拓扑校验兜底重排；确认页数据含 保留/跳过/重排理由/补充 四清单
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: 目标驱动课程生成`

### Task 10: 课程创建向导 UI

**Files:**
- Create: `src/app/courses/new/page.tsx`、`src/app/api/courses/route.ts`
- Test: `tests/api/courses.test.ts`

**Interfaces:**
- Consumes: Task 9 `composeCourse`
- Produces: `POST /api/courses`；向导页四步：选教材 → 选学科类型（展示 6 类 + 自定义提示词入口）→ 填学习目标与课程提示词 → 选学习模式 → 大纲确认（可手动删节点/调顺序）

- [ ] **Step 1: 写失败测试**：POST 参数校验（缺 goal → 400）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** route + 向导页（shadcn Stepper）
- [ ] **Step 4: 运行确认通过 + 手动走完四步**
- [ ] **Step 5: Commit** — `feat: 课程创建向导`

### Task 11: 课件流式生成（RAG 注入 + 来源标注）

**Files:**
- Create: `src/lib/agent/lesson-writer.ts`、`src/app/api/lessons/[kpId]/route.ts`、`src/components/lesson-view.tsx`
- Test: `tests/agent/lesson-writer.test.ts`（mock LLM + mock retrieve）

**Interfaces:**
- Consumes: `searchChunks`、`getEmbeddingModel`、学科提示词
- Produces:
  ```ts
  streamLesson(courseId: string, kpId: string): StreamTextResult
  // 检索教材分块作上下文锚点；输出 Markdown（不是 MDX——不信任模型生成可执行代码）
  // 渲染用 react-markdown + 白名单组件（代码高亮/KaTeX/图片/视频卡片）
  // 引用教材处输出 [src:chapterId:index] 标记，前端渲染为可点击来源徽标
  ```

- [ ] **Step 1: 写失败测试**：prompt 组装含检索到的教材片段与学科提示词；`[src:...]` 标记解析函数正确提取引用
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** `streamText` + react-markdown 渲染组件（白名单组件映射，来源徽标点击跳教材阅读页对应 anchor）
- [ ] **Step 4: 运行确认通过 + 手动看一节流式课件**
- [ ] **Step 5: Commit** — `feat: 课件流式生成与来源标注`

### Task 12: 出题器（生成—校验—发布）

**Files:**
- Create: `src/lib/agent/question-gen.ts`、`src/lib/agent/question-verify.ts`、`src/app/api/questions/route.ts`
- Test: `tests/agent/question-gen.test.ts`、`tests/agent/question-verify.test.ts`

**Interfaces:**
- Consumes: `searchChunks`（仅传已解锁知识点语料）
- Produces:
  ```ts
  generateQuestions(input: { courseId: string; scope: 'knowledgePoint'|'chapter'|'course';
    scopeId: string; count: number; difficulty: 'easy'|'medium'|'hard';
    unlockedKPIds: string[] }): Promise<Question[]>
  // generateObject 输出 { type: choice|fill|code, stem, options?, answer, referenceSolution?,
  //   testCases?, rubric, sourceKPIds } —— 生成后须过 verifyQuestion 才入库
  verifyQuestion(q: Question, unlockedKPIds: string[]): Promise<{ ok: boolean; reason?: string }>
  // 校验：参考解法实际依赖知识 ⊆ unlockedKPIds；答案与解法一致；code 题由执行器跑通才算 ok
  ```

- [ ] **Step 1: 写失败测试**：`unlockedKPIds` 仅 1 个时，注入语料不含未解锁内容（Review Focus #3）；verify 拒绝标为"循环"但解法是递归的题；缺 referenceSolution 的 code 题被拒
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：语料检索限定已解锁知识点；校验器独立调用（不给生成上下文，防串谋）；校验失败重生成一次，仍败则丢弃；合格题落库再发布
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: 出题器（生成—校验—发布）`

### Task 13: 判题器（执行器+LLM 分工）+ 掌握度模型 + 分层提示

**Files:**
- Create: `src/lib/agent/judge.ts`、`src/lib/agent/executor.ts`、`src/lib/agent/mastery.ts`
- Test: `tests/agent/judge.test.ts`、`tests/agent/mastery.test.ts`、`tests/agent/executor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  judgeAnswer(questionId: string, userAnswer: string): Promise<{ correct: boolean; score: number; feedback: string }>
  // choice/fill 本地比对；code 题执行器跑 testCases 判对错，LLM 仅解释错误（设计 §5.8）
  runCode(lang: 'javascript'|'python', code: string, testCases: TestCase[]): Promise<RunResult>
  // python 走 Judge0（JUDGE0_URL，VPS Docker 自部署）；javascript 走 node:vm 沙箱
  getHint(questionId: string, level: 1|2|3|4): Promise<string>  // 概念→思路→步骤→完整解析
  updateMastery(kpId: string, correct: boolean): number
  // 答对 m'=1-(1-m)*0.5；答错 m'=m*0.5；乘 exp(-Δdays/30) 衰减；m≥0.8 即 mastered
  ```

- [ ] **Step 1: 写失败测试**：客观题判分；初值 0 连对 3 次 = 0.875 ≥ 0.8；30 天前记录衰减后 < 当前值；答错减半且状态回退；JS 沙箱执行断言通过/失败各一例；提示分级返回不同粒度
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：`node:vm` 沙箱（超时 5s、禁 require）；Judge0 客户端（未配置 JUDGE0_URL 时明确提示）；掌握度公式按上；分层提示按等级注入提示词
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: 判题（执行器+LLM 分工）与掌握度模型`

### Task 14: 学习页（三模式状态机 + 答题 UI）

**Files:**
- Create: `src/app/learn/[courseId]/page.tsx`、`src/lib/agent/learn-flow.ts`、`src/components/quiz-panel.tsx`
- Test: `tests/agent/learn-flow.test.ts`

**Interfaces:**
- Consumes: Task 11-13 全部
- Produces:
  ```ts
  nextStep(courseId: string): LearnStep
  // LearnStep = { kind: 'lesson'|'quiz'|'chapterQuiz'|'finalQuiz'|'done', kpId?, questions? }
  // 状态：locked/unlocked/learned/mastered（设计 §5.3）；模式 2 默认"做完即解锁"，阈值可配置；
  // switchMode(courseId, mode)：保留全部学习记录，仅重排后续步骤；
  // 模式 3 无记录用户先走 diagnostic（简短诊断/声明基础）建立出题范围
  ```

- [ ] **Step 1: 写失败测试**：三种模式各推一遍状态机，断言步骤序列符合设计 §5.3；模式 2 未做完不解锁下一 KP；switchMode 后答题记录保留；模式 3 无诊断时第一步为 diagnostic
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** `learn-flow.ts` 纯函数状态机 + 学习页（左侧大纲树/右侧内容，答题面板流式反馈）
- [ ] **Step 4: 运行确认通过 + 手动三模式各走一章**
- [ ] **Step 5: Commit** — `feat: 三模式学习流程`

### Task 15: 可视化（热力图 + 知识图谱 + 进度）

**Files:**
- Create: `src/app/stats/page.tsx`、`src/components/heatmap.tsx`、`src/components/knowledge-graph-view.tsx`
- Test: `tests/stats/aggregate.test.ts`（聚合函数单测）

**Interfaces:**
- Consumes: attempts / knowledge_points 表
- Produces: 聚合函数 `dailyActivity(): { date: string; count: number }[]`；图谱数据 `graphData(): { nodes: {id,title,mastery,status}[], edges }`

- [ ] **Step 1: 写失败测试**：聚合函数对固定 fixture 数据返回正确日期桶与掌握度分档（绿≥0.8/黄0.4-0.8/红<0.4/灰未解锁）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** 聚合 + ECharts 日历热力图 + @xyflow/react 知识图谱（节点按掌握度着色，附等价列表视图）+ 课程进度条
- [ ] **Step 4: 运行确认通过 + 页面手动验证**
- [ ] **Step 5: Commit** — `feat: 学习可视化`

### Task 16: 笔记 + Obsidian 导入导出

**Files:**
- Create: `src/app/api/notes/route.ts`、`src/lib/obsidian/sync.ts`、`src/components/note-editor.tsx`
- Test: `tests/obsidian/sync.test.ts`

**Interfaces:**
- Produces:
  ```ts
  importVaultArchive(zip: Buffer): Promise<number>  // 导入 vault zip 入 RAG 补充库，返回文件数
  exportNoteToMarkdown(note: Note): string  // 导出 .md（下载；本地部署且配置 vault 路径时可写入）
  // 首版不做实时双向同步（设计 §5.6.1）；路径无效返回 { ok:false, degraded:true }（Review Focus #5）
  ```

- [ ] **Step 1: 写失败测试**：zip 导入后分块可检索；导出内容与笔记一致；无效路径返回 degraded 而非 throw
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** 导入/导出 + 笔记编辑器（TipTap，挂知识点）+ 设置页 vault 配置区
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: 笔记与 Obsidian 导入导出`

### Task 17: MCP 客户端 + 素材收集

**Files:**
- Create: `src/lib/mcp/client.ts`、设置页 MCP 配置区、`src/components/agent-activity.tsx`
- Test: `tests/mcp/client.test.ts`

**Interfaces:**
- Consumes: AI SDK 的 MCP 支持（`@ai-sdk/mcp` 的 `createMCPClient`；首版仅只读工具）
- Produces:
  ```ts
  getMcpTools(): Promise<ToolSet>  // 读 settings 表中的 server 列表，连接失败单个跳过+提示
  ```

- [ ] **Step 1: 写失败测试**：配置 1 个假 server（本地 stdio echo）→ tools 非空；不可达 server 被跳过不阻塞
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** client + 课件生成时把 MCP tools 传给 `streamText` + UI 工具调用过程可视化（折叠面板展示调用了什么工具、返回摘要）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat: MCP 工具集成`

### Task 18: 设置页 + 自定义提示词管理

**Files:**
- Create: `src/app/settings/page.tsx`、`src/app/api/settings/route.ts`、`src/app/api/prompts/route.ts`
- Test: `tests/api/prompts.test.ts`

**Interfaces:**
- Produces: 设置页四区：LLM Provider（baseURL/model/key，测试连接按钮）、Embedding 模型、MCP servers、Obsidian vault；提示词 CRUD（新建/编辑/导入导出 .md）

- [ ] **Step 1: 写失败测试**：设置读写；自定义提示词 CRUD；导出内容与导入往返一致
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** 页面与 API
- [ ] **Step 4: 运行确认通过 + 手动改提示词重建一门课验证生效**
- [ ] **Step 5: Commit** — `feat: 设置页与提示词管理`

### Task 19: 提交物与部署

**Files:**
- Create: `Dockerfile`、`docker-compose.yml`、`README.md`（10 分钟复现指南）、`docs/技术文档.md`（后转 PDF）

**Interfaces:**
- Consumes: 全部前置任务

- [ ] **Step 1: README 复现指南**：clone → `.env.local` 模板 → `pnpm install && pnpm dev`，实测计时 ≤ 10 分钟
- [ ] **Step 2: VPS 部署**：Docker 构建通过（含 Judge0 服务），内置一本示例教材（自编写无版权内容），公网可访问；**DEMO_MODE=true 生效**：设置页只读、调用限额、上传限制、会话隔离、数据定时重置（设计 §5.6.2）
- [ ] **Step 3: 技术文档**：按赛道模板写项目概述/架构/AI 方案（Agent 编排、RAG 策略、出题约束）/创新点，≤30 页
- [ ] **Step 4: 演示视频脚本**：痛点→导入→目标定制→三模式→可视化→MCP，5-8 分钟分镜
- [ ] **Step 5: 最终 Commit + 检查 Git 历史细粒度**

---

## 自检记录

- **Spec 覆盖**：§5.1→T2-5，§5.2→T11，§5.3→T12-14，§5.4→T6+T18，§5.5→T8-9，§5.6→T15-16，§5.7→T17，§7→T19 ✓
- **类型一致性**：`ChapterTree`/`Question`/`LearnStep` 等跨任务签名已对齐
- **Review Focus**：5 条均已挂到对应任务测试
