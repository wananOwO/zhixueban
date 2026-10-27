# 智学伴前端重做与线上站 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 删除第一版页面，以「朱批本」视觉从零重写 13 个页面；新增 SSE 任务流、Agent 轨迹、AI 助教；新增线上模式（每浏览器独立空间、Key 只在浏览器与服务器内存）。

**架构：** 在现有 Next 16 应用内重写 `src/app`（页面）与 `src/components`（全部删除重建）；`src/lib/verified-learning` 只做增量扩展（新增文件为主，`route.ts`、`local-access.ts`、`agent/provider.ts`、`provider-error.ts`、`model.ts`、`migrations.ts`、`library.ts` 定点修改）。线上/本地两种模式由 `VL_MODE` 环境变量切换，集中在 `src/lib/verified-learning/mode.ts`。

**技术栈：** Next.js 16.4（App Router，Turbopack 默认）、React 19.3、TypeScript 7、Tailwind CSS v4、shadcn/ui（radix-ui 1.8）、TanStack Query 5、zustand 5、Vercel AI SDK（`ai` 7.0.143 + `@ai-sdk/react` 4.0.147）、motion、CodeMirror 6、sonner、Vitest、Playwright 1.61。

**规格：** `docs/superpowers/specs/2026-10-27-frontend-redesign-design.md`（以下称「规格」；冲突时以规格为准）。视觉参照：`.superpowers/brainstorm/frontend-redesign/d-course.html`（融合样张）、`a-zhupi.html`（课件页）、`b-yingguang.html`（生成过程与书带）。

## 全局约束

- 语言：界面文案、代码注释、提交信息一律简体中文。
- 颜色令牌（规格 6.2，原样）：底色 `#f3f3f1`、纸面 `#ffffff`、次级面 `#ecebe8`、墨 `#1c1b1a`、次文字 `#5c5b57`、朱批 `#b4182b`、朱批浅底 `#fbefef`、线 `#e3e2de`。朱批只用于出处、批改、当前位置。不做暗色主题。
- 字体：Noto Serif SC（课件正文、页面标题）、Noto Sans SC（界面）、JetBrains Mono（代码），全部自托管，访问者不请求 Google。
- 字号阶梯 12 / 14 / 17.5 / 23 / 30（rem 换算：0.75 / 0.875 / 1.09375 / 1.4375 / 1.875）；课件正文行宽 30–38 个汉字。
- 铺满：页面不设最大宽度，左右边距 1.5rem（手机 1rem）；根字号 `clamp(16px, calc(16px + (100vw - 1440px) * 0.0045), 21px)`。
- 禁止：渐变、发光、毛玻璃、图标方块卡片、emoji、伪造进度或数字。阴影只给浮层。圆角：纸面 4px、控件 6px。
- 所有进度、计数、引用来自真实接口数据；没有数据就显示空状态，不编造。
- 无障碍：每页一个 h1；所有控件可键盘操作并有可见焦点（`outline: 2px solid` 墨色）；动效尊重 `prefers-reduced-motion`。
- 线上模式下模型 Key 绝不进入：数据库、`vl_jobs.input_json`、Agent 会话、日志、错误信息、SSE 事件、URL。
- 依赖安装：pnpm；`pnpm-workspace.yaml` 的 `allowBuilds` 策略保持（不运行新依赖的安装脚本）。若 pnpm 的最小发布时长策略拒绝某个刚发布的版本，选用其前一个满足策略的版本，并在账本记录。
- 不改后端教学语义：掌握标准、先修校验、引用回查、幂等、判题隔离保持原样；现有 37 个测试文件全部继续通过（导航测试按新路由改写）。
- 本地模式行为保持：仅 `127.0.0.1:3101` 同源、终端口令登录、设置页写数据库。
- 不提交 `data/`、`.superpowers/`；提交信息遵循仓库现有风格（emoji + 中文标题 + 列表）。

## 审查重点

规格隐含、但各任务测试不一定覆盖、最可能伤到使用者的情况。每条都已在负责的任务中加了测试：

1. **线上模式两个浏览器的数据互相可见或可删**（任务 3：跨空间读取教材/草稿/任务返回 404 的测试）。
2. **Key 在出错时被写进任务错误信息**——供应商 401 响应体常回显 Key 片段（任务 4：`redact` 遮蔽请求内 Key 的测试；任务 15 端到端全文搜索）。
3. **服务器重启后任务卡死**：内存 Key 丢失，任务既不失败也不提示（任务 4：无 Key 时 `createAgentConnection` 抛出可识别的 `MODEL_KEY_REQUIRED`，任务转为可恢复失败的测试）。
4. **SSE 在任务已结束时连上**：连接应立即收到全部历史事件与结束事件，而不是挂起（任务 5：终态任务的流测试）。
5. **助教在答题时泄露答案**：当前活动有未作答题目时，助教上下文含答案（任务 6：未作答时上下文不含 answer/explanation 的测试）。

---

## 文件结构

**删除（第一版前端，已备份于 Git 标签 `frontend-v1-backup`）：**
`src/app/page.tsx`、`src/app/settings/`、`src/app/verified-learning/`（整个目录）、`src/components/verified-learning/`（整个目录）、`src/lib/navigation.ts`、`src/lib/verified-learning/client.ts`（被 `src/lib/api/` 取代；`draft-editor.ts` 对它的类型引用改到新位置）。

**后端新增：**

| 文件 | 职责 |
|---|---|
| `src/lib/verified-learning/mode.ts` | 读取 `VL_MODE`、`VL_PUBLIC_ORIGIN`、`VL_ACCESS_CODE`；线上配额常量 |
| `src/lib/verified-learning/online-access.ts` | 线上模式登录、空间 cookie、空间登记、登录限流 |
| `src/lib/verified-learning/access.ts` | 按模式分派：`assertRequest`、`requireAccess`、`loginWith`、`logoutWith` |
| `src/lib/verified-learning/model-keys.ts` | 进程内存 Key 表（任务 ID → 连接配置）与请求头解析 |
| `src/lib/verified-learning/trace.ts` | 从 `vl_agent_states` 提取脱敏工具调用轨迹 |
| `src/lib/verified-learning/job-stream.ts` | SSE 响应：轮询事件、心跳、终态关闭 |
| `src/lib/verified-learning/tutor.ts` | 助教上下文构建（防泄题）与 `streamText` 调用 |
| `src/lib/verified-learning/quota.ts` | 线上模式生成配额（每空间并发 1、每日 20、全站并发 6） |
| `src/lib/verified-learning/sample-course.ts` | 示例课程：从模板空间复制到新空间 |
| `src/lib/verified-learning/cleanup.ts` | 30 天未访问空间清理 |
| `scripts/sample-export.ts` | 从指定空间导出示例课程为 JSON |
| `src/proxy.ts` | 安全响应头（CSP 等），线上模式 HTTPS 跳转不在此处理（交给 Nginx） |

**前端新增（`src/` 下）：**

| 路径 | 职责 |
|---|---|
| `app/layout.tsx`、`app/globals.css`、`app/fonts.ts` | 根布局、设计令牌、字体 |
| `app/(app)/layout.tsx` | 访问门禁 + 顶栏外壳 |
| `app/(app)/page.tsx` | 首页 |
| `app/(app)/library/page.tsx`、`library/[bookId]/page.tsx` | 教材库、教材详情 |
| `app/(app)/drafts/page.tsx`、`drafts/[draftId]/page.tsx` | 草稿列表、草稿（编辑/生成/审核三态） |
| `app/(app)/courses/page.tsx`、`courses/[courseId]/page.tsx` | 课程列表、课程主页 |
| `app/(app)/learn/[sessionId]/page.tsx`、`learn/[sessionId]/history/page.tsx` | 学习、历史回看 |
| `app/(app)/settings/page.tsx` | 设置 |
| `lib/api/client.ts`、`lib/api/types.ts`、`lib/api/queries.ts` | 请求封装、契约类型、TanStack Query 键与 hooks |
| `lib/stores/model-key.ts` | zustand：浏览器端模型配置（线上模式） |
| `lib/stores/tutor-history.ts` | zustand：助教对话按会话存 localStorage |
| `lib/roadmap.ts` | 路线图分层与排序算法（纯函数） |
| `lib/tape.ts` | 书带区间合并（纯函数） |
| `lib/nav.ts` | 主导航条目 |
| `components/ui/*` | shadcn 原语（重写样式）：button、dialog、dropdown-menu、tabs、tooltip、checkbox、radio-group、select、textarea、input、label、sonner |
| `components/shell/*` | 顶栏、移动菜单、访问门禁、登录页、模型 Key 状态 |
| `components/zhupi/*` | 标志性组件：`citation-note`、`grade-mark`、`roadmap`、`tape`、`source-drawer` |
| `components/states/*` | `block-loading`、`block-empty`、`block-error` |
| `components/library/*`、`drafts/*`、`courses/*`、`learn/*`、`settings/*` | 各页面区块 |

---

### 任务 1：前端地基（依赖、令牌、字体、外壳、请求层）

**文件：**
- 删除：上文「删除」所列全部文件
- 修改：`package.json`、`next.config.ts`、`src/lib/verified-learning/draft-editor.ts:1`、`tests/navigation.test.ts`
- 新建：`src/app/layout.tsx`、`src/app/globals.css`、`src/app/fonts.ts`、`src/app/(app)/layout.tsx`、`src/app/(app)/page.tsx`（占位，任务 8 完成）、`src/lib/api/{client,types,queries}.ts`、`src/lib/nav.ts`、`src/components/ui/*`、`src/components/shell/{top-bar,mobile-menu,access-gate,login-form}.tsx`、`src/components/states/*`、`eslint.config.mjs`、`.prettierrc.json`、`components.json`、`vitest.config.ts`（加 jsdom 项目）
- 测试：`tests/navigation.test.ts`、`tests/frontend/api-client.test.ts`

**接口：**
- 产出：
  - `api<T>(path: string, init?: { method?: 'GET'|'POST'|'PATCH'|'DELETE'; body?: unknown; key?: string; modelHeader?: boolean }): Promise<T>`，失败抛 `ApiError { status: number; code: string; message: string; retryable: boolean }`；401 时派发 `window` 事件 `vl:unauthorized`。`modelHeader: true` 时由任务 4 的 `modelHeaderValue()` 附加 `X-VL-Model` 头。
  - `newKey(): string`（`crypto.randomUUID()`）。
  - `src/lib/api/types.ts`：从旧 `client.ts` 迁移全部契约类型（`BookView`、`FormDraft`、`SessionView`、`RunView`、`ProgressView`、`JobView` 等，字段不变），新增 `ProgrammingLanguageName`。
  - `queryKeys`：`books(q, archived)`、`book(id)`、`drafts()`、`draft(id)`、`courses()`、`session(id)`、`run(id)`、`progress(versionId)`、`notes(courseId)`、`jobs()`、`job(id)`、`trace(id)`、`history(sessionId)`、`settings()`、`templates()`、`mode()`。
  - `navItems: { href: string; label: string }[]` = 首页 `/`、教材库 `/library`、我的课程 `/courses`、课程草稿 `/drafts`、设置 `/settings`。
  - CSS 令牌（`globals.css` 的 `@theme`）：`--color-ground`、`--color-paper`、`--color-raised`、`--color-ink`、`--color-muted`、`--color-zhu`、`--color-zhu-tint`、`--color-line`、`--color-control`；`--font-serif`、`--font-sans`、`--font-mono`；`--radius-paper: 4px`、`--radius-control: 6px`。
  - 组件：`<BlockLoading lines={n} />`、`<BlockEmpty title action? />`、`<BlockError error onRetry? />`、`<Button variant="primary"|"secondary"|"ghost"|"danger" size="md"|"sm">`。

- [ ] **步骤 1：安装依赖**

运行：
```powershell
pnpm add radix-ui@1.8.1 @tanstack/react-query@5.105.0 zustand@5.0.16 @ai-sdk/react@4.0.147 ai@7.0.143 motion sonner@2.0.8 codemirror@6.0.2 @codemirror/state @codemirror/view @codemirror/lang-python @codemirror/lang-javascript @codemirror/lang-cpp @codemirror/language @lezer/highlight @fontsource-variable/noto-serif-sc @fontsource-variable/noto-sans-sc @fontsource-variable/jetbrains-mono
pnpm add -D @playwright/test@1.61.0 @axe-core/playwright@4.14.0 @testing-library/react@16.3.3 @testing-library/dom jsdom eslint eslint-config-next@16.4.3 prettier@3.9.10
```
预期：安装成功；`pnpm ls ai @ai-sdk/react` 显示 `ai 7.0.143` 唯一一份。

- [ ] **步骤 2：验证中文字体文件可本地分发**

`app/fonts.ts` 先尝试 `next/font/google`（`Noto_Serif_SC`、`Noto_Sans_SC` 需 `preload: false`，因 Google 不提供 CJK `subsets`；`JetBrains_Mono` 用 `subsets: ['latin']`）。运行 `pnpm build`。
预期：构建成功且 `.next/static/media` 下出现 woff2；若构建失败或文件缺失，改为在 `globals.css` 用 `@import '@fontsource-variable/noto-serif-sc'` 等三个包（自带 unicode-range 分片，按需加载），在账本记 Ruling。

- [ ] **步骤 3：改写导航测试为新路由（先失败）**

`tests/navigation.test.ts`：
```ts
it('五项主导航与全部静态页面一一对应', () => {
  expect(navItems.map(i => i.href)).toEqual(['/', '/library', '/courses', '/drafts', '/settings']);
  const routes = pages('src/app').filter(f => !f.includes('[')).map(toRoute); // 去掉 (app) 路由组段
  expect(routes.sort()).toEqual(['/', '/courses', '/drafts', '/library', '/settings']);
});
it('第一版页面与组件目录已删除', () => {
  for (const f of ['src/app/verified-learning', 'src/components/verified-learning', 'src/lib/navigation.ts', 'src/lib/verified-learning/client.ts'])
    expect(existsSync(f), f).toBe(false);
});
it('外壳只在 (app) 布局挂载一次', () => {
  expect(readFileSync('src/app/(app)/layout.tsx', 'utf8')).toContain('<TopBar');
  for (const file of pages('src/app')) expect(readFileSync(file, 'utf8'), file).not.toContain('<TopBar');
});
```
运行：`pnpm vitest run tests/navigation.test.ts` → 预期 FAIL。

- [ ] **步骤 4：写请求层测试（先失败）**

`tests/frontend/api-client.test.ts`（jsdom 环境，`vi.stubGlobal('fetch', ...)`）：
- 成功信封 `{contractVersion:1,data:{a:1}}` → 返回 `{a:1}`；
- 409 信封 → 抛 `ApiError`，`status===409`、`code==='VERSION_CONFLICT'`；
- 401 → 派发 `vl:unauthorized` 一次；
- 网络异常 → `ApiError` `code==='NETWORK'`、`retryable===true`；
- 传 `key` → 请求头 `Idempotency-Key` 等于该值；`FormData` 正文不设 `Content-Type`。

运行：`pnpm vitest run tests/frontend/api-client.test.ts` → 预期 FAIL（模块不存在）。

- [ ] **步骤 5：删除第一版文件，实现地基**

按「文件」清单删除并新建。要点：
- `src/app/layout.tsx`：`<html lang="zh-CN">`，挂字体变量 class，`<Providers>`（QueryClient：`staleTime: 5_000`、`retry: (n, e) => e instanceof ApiError && e.retryable && n < 2`）+ `<Toaster>`。不再使用 `next-themes`（规格：不做暗色）——从 `package.json` 移除。
- `src/app/(app)/layout.tsx`：`<AccessGate>` 包裹 `<TopBar />` 与 `<main id="main">`；跳到正文链接。
- `AccessGate`：`GET /access` 200 → 渲染子树；401 → `<LoginForm>`；监听 `vl:unauthorized` 切回登录。`GET /mode`（任务 3 新增；本任务若 404 视为本地模式）决定登录文案：本地「输入启动服务时终端生成的访问口令」，线上「输入访问码」。
- `TopBar`：标志（朱红方印「学」+ 宋体「智学伴」）、`navItems`（`aria-current="page"`）、右侧模型 Key 状态位（任务 4 接入，本任务留插槽）、手机端菜单按钮（Radix Dialog 全屏菜单）。
- `globals.css`：Tailwind v4 `@import 'tailwindcss'`；`@theme` 令牌；`html { font-size: clamp(...) }`；`:focus-visible` 墨色描边；`prefers-reduced-motion` 关闭动画。
- `draft-editor.ts` 第 1 行改为 `import type { ProgrammingLanguageName } from '@/lib/api/types';`。
- `next.config.ts` 保留 `serverExternalPackages`，新增 `headers()`：`/api/verified-learning/v1/jobs/:id/stream` 加 `X-Accel-Buffering: no`。
- `eslint.config.mjs`：`eslint-config-next` 扁平配置；`package.json` 新增脚本 `"lint": "eslint ."`、`"format": "prettier --write ."`、`"test:e2e": "playwright test"`。

- [ ] **步骤 6：运行并通过**

运行：`pnpm vitest run tests/navigation.test.ts tests/frontend/api-client.test.ts` → 预期 PASS。
运行：`pnpm exec tsc --noEmit --incremental false` → 预期 0 错误。

- [ ] **步骤 7：外观自检**

`pnpm dev`（本地模式，按 `docs/verified-learning/frontend-handoff.md` 启动参数）打开 `/`：顶栏、登录页在 1440 与 390 宽度截图（Playwright 截图脚本 `scripts/shot.mjs <url> <out>`，本任务新建，后续复用）。
预期：顶栏一行不换行；手机端导航收进菜单；焦点环可见。

- [ ] **步骤 8：提交**

```powershell
git add -A src tests package.json pnpm-lock.yaml next.config.ts eslint.config.mjs .prettierrc.json components.json vitest.config.ts scripts/shot.mjs
git commit -m "♻️ 重建前端地基：朱批本设计令牌、字体、外壳与请求层"
```

---

### 任务 2：数据库 v5 与线上空间登记

**文件：**
- 修改：`src/lib/verified-learning/migrations.ts`、`src/lib/verified-learning/initialization.ts`（PRAGMA）、`tests/verified-learning/{migrations-v2,store,initialization,server}.test.ts` 中断言版本 4 的位置
- 测试：`tests/verified-learning/migrations-v5.test.ts`

**接口：**
- 产出：`CURRENT_SCHEMA_VERSION = 5`；新表
  ```sql
  CREATE TABLE vl_spaces (
    space_id TEXT PRIMARY KEY CHECK (length(space_id) = 43),
    created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    sample_seeded INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE vl_generation_usage (
    space_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (space_id, day)
  );
  ```
- 打开数据库时设置 `journal_mode = WAL`、`busy_timeout = 5000`（规格 8.2：生成中并发读写）。

- [ ] **步骤 1：写失败测试** `migrations-v5.test.ts`：v4 库迁移后 `vl_schema_migrations` 为 `[1..5]`；两张新表存在；迁移前生成 `.vl-v5-*.bak` 备份；新建库 `journal_mode` 为 `wal`（文件库）。
- [ ] **步骤 2：运行** `pnpm vitest run tests/verified-learning/migrations-v5.test.ts` → FAIL。
- [ ] **步骤 3：实现** 在 `migrations.ts` 追加 `SCHEMA_V5` 并把版本数组扩为 5 项；`initialization.ts` 打开时设 WAL 与 busy_timeout。把现有测试中 `version: 4`/`schemaVersion: 4`/`[1,2,3,4]` 改为 5。
- [ ] **步骤 4：运行** `pnpm test` → 全部 PASS。
- [ ] **步骤 5：提交** `git commit -m "🗃️ 新增 schema v5：线上空间与生成配额表，启用 WAL"`

---

### 任务 3：线上模式访问控制与空间隔离

**文件：**
- 新建：`mode.ts`、`online-access.ts`、`access.ts`、`cleanup.ts`
- 修改：`server.ts`（`getLocalServices` → `getServices` 调 `access.ts`）、`route.ts`（access 分支与新 `GET /mode`；上传目录按空间分子目录）、`library.ts`（`importFile` 上限按模式：本地 50MiB、线上 20MiB 且每空间 10 本）
- 测试：`tests/verified-learning/online-access.test.ts`、`tests/verified-learning/space-isolation.test.ts`

**接口：**
- `mode.ts`：
  ```ts
  export type VlMode = 'local' | 'online';
  export function readMode(env = process.env): { mode: VlMode; publicOrigin: string | null; accessCode: string | null };
  export const ONLINE_LIMITS = { uploadBytes: 20 * 1024 * 1024, booksPerSpace: 10, concurrentPerSpace: 1, dailyPerSpace: 20, concurrentGlobal: 6, sessionDays: 30, spaceDays: 90, idleDeleteDays: 30, loginPerMinutePerIp: 5 } as const;
  ```
  线上模式要求 `VL_PUBLIC_ORIGIN`（`https://` 开头、无路径）与 `VL_ACCESS_CODE`（≥ 8 字符），缺失抛 `AppError('DISABLED')`。
- `access.ts`：
  ```ts
  export function assertRequest(request: Request): void;            // 本地：assertLocalRequest；线上：Origin/Host 必须等于 publicOrigin，写操作必须带 Origin，拒绝 sec-fetch-site: cross-site
  export function requireAccess(db, request: Request): { scopeId: string };
  export function loginWith(db, request: Request, secret: string): { cookies: string[]; expiresAt: string; scopeId: string };
  export function logoutWith(db, request: Request): string[];        // Set-Cookie 值
  ```
- 线上 cookie：`vl_session`（同现有格式，`Secure; HttpOnly; SameSite=Lax; Max-Age=30天`）、`vl_space`（43 位 base64url，`Secure; HttpOnly; SameSite=Lax; Max-Age=90天`）。登录：访问码正确 → 若请求带有效 `vl_space` 且该空间存在则复用，否则新建空间（`vl_spaces` 插入）；会话行 `scope_id` = 空间 ID。每次 `requireAccess` 更新 `last_seen_at`（同一分钟内不重复写）。
- 登录限流：线上按 `x-real-ip`（Nginx 设置；缺失时用 `'unknown'`）每分钟 5 次，进程内存计数。
- `GET /mode` → `{ mode, uploadLimitBytes, booksPerSpace }`，不需登录。
- `cleanup.ts`：`removeIdleSpaces(db, uploadsRoot, now): number` 删除 `last_seen_at` 早于 30 天的空间的全部 `scope_id` 行（按外键顺序）与 `uploads/<space>/` 目录；在线上模式每次进程启动后与每 6 小时运行一次（`setInterval(...).unref()`，挂在 `server.ts` 首次调用处）。

- [ ] **步骤 1：写失败测试** `online-access.test.ts`（`vi.stubEnv('VL_MODE','online')` 等）：
  - 访问码错误 401；同一 IP 第 6 次 429（`LIMIT_EXCEEDED`）；
  - 首次登录返回两个 Set-Cookie，均含 `Secure`、`HttpOnly`；
  - 带旧 `vl_space` 重新登录 → `scopeId` 不变；不带 → 新 `scopeId`；
  - Origin 为 `https://evil.example` 的 POST → 403；
  - `GET /mode` 未登录 200 且 `mode==='online'`；
  - 本地模式下 `GET /mode` 返回 `mode==='local'`，原 `local-access.test.ts` 不改仍通过。
- [ ] **步骤 2：写失败测试** `space-isolation.test.ts`：空间 A 上传教材、建草稿、建任务；空间 B 的 cookie 访问 `GET /textbooks/{A的id}`、`GET /drafts/{A的id}`、`GET /jobs/{A的id}`、`DELETE /drafts/{A的id}` 全部 404；B 的 `GET /textbooks` 列表为空；上传文件位于 `uploads/<A>/`。另测 `removeIdleSpaces` 删除 31 天未访问的空间且保留 29 天的。
- [ ] **步骤 3：运行** 两个测试文件 → FAIL。
- [ ] **步骤 4：实现** 按接口实现；`route.ts` 的 `services()` 改用 `getServices(request)`，`schedule()` 不变（后台任务按 `scope` 运行，已隔离）。
- [ ] **步骤 5：运行** `pnpm test` → 全部 PASS。
- [ ] **步骤 6：提交** `git commit -m "✨ 新增线上模式：访问码登录、每浏览器独立空间与空间清理"`

---

### 任务 4：模型 Key 只在浏览器与服务器内存

**文件：**
- 新建：`model-keys.ts`、`quota.ts`、`src/lib/stores/model-key.ts`、`src/components/shell/model-key-status.tsx`
- 修改：`agent/provider.ts`（`createAgentConnection(config?)`）、`model.ts`（透传连接配置）、`provider-error.ts`（`redact` 接受额外密钥）、`route.ts`（需要模型的端点读取请求头、登记/清除内存 Key、配额检查；线上模式下 `PATCH /settings` 返回 403）、`model-list.ts` 调用处（线上只用请求头 Key）
- 测试：`tests/verified-learning/model-keys.test.ts`、`tests/verified-learning/quota.test.ts`、`tests/frontend/model-key-store.test.ts`

**接口：**
- 请求头 `X-VL-Model`：base64url(JSON `{ provider: 'openai-compatible'|'anthropic', baseUrl: string, apiKey: string, model: string }`)，长度 ≤ 8192；解析失败 400。只有以下端点读取：`POST /drafts/{id}/generate`、`POST /jobs/{id}/resume`、`POST /sessions/{id}/start`、`POST /sessions/{id}/remedial`、`POST /sessions/{id}/tutor`、`POST /settings/models`。
- `model-keys.ts`：
  ```ts
  export interface ModelConfig { provider: 'openai-compatible' | 'anthropic'; baseUrl: string; apiKey: string; model: string }
  export function parseModelHeader(value: string | null): ModelConfig | null;
  export function rememberJobKey(scope: string, jobId: string, config: ModelConfig): void;
  export function jobKey(scope: string, jobId: string): ModelConfig | undefined;
  export function forgetJobKey(scope: string, jobId: string): void;
  export function allSecrets(): string[];   // 供 redact 使用
  ```
  内存 `Map`；任务到达终态（`succeeded`/`failed`/`cancelled`/`waiting_user`）时由 `schedule()` 的 `finally` 调 `forgetJobKey`。
- `createAgentConnection(config?: ModelConfig)`：传入则用之；本地模式未传则读设置（现有行为）；线上模式未传抛 `AppError('PROVIDER_ERROR', '需要在设置中填写模型 Key 后继续')` 并带 `code` 字段 `MODEL_KEY_REQUIRED`（任务错误 `retryable: true`，前端据此显示「填写 Key 后继续」）。
- `quota.ts`：`checkGenerationQuota(db, scope, now): void`（超限抛 `AppError('LIMIT_EXCEEDED')`）、`countGeneration(db, scope, now)`；全站并发数 = `vl_jobs` 中 `status IN ('queued','running')` 且 kind 为生成类的行数。本地模式直接返回。
- 前端 `useModelKey` store（zustand `persist`，键 `vl-model`，`localStorage`）：`{ config: ModelConfig | null; set(c); clear() }`；`modelHeaderValue(): string | null`。线上模式下 `api(..., { modelHeader: true })` 附加该头；本地模式不附加。

- [ ] **步骤 1：写失败测试** `model-keys.test.ts`：
  - 线上模式发起生成：请求头带 Key → 202；`vl_jobs.input_json`、`vl_agent_states`、`vl_job_events` 全表 `LIKE '%<key>%'` 为 0；
  - 任务以 faux 连接失败且供应商错误体含 Key → `error_json` 不含 Key（`[已隐藏]`）；
  - 进程「重启」（调用 `forgetJobKey` 模拟）后 runner 执行 → 任务 `failed`、`error.code==='MODEL_KEY_REQUIRED'`、`resumable===true`；
  - 线上 `PATCH /settings` → 403；本地模式 `PATCH /settings` 照旧 200。
- [ ] **步骤 2：写失败测试** `quota.test.ts`：同空间已有运行中生成任务 → 第二个 429；当天第 21 次 → 429；全站 6 个运行中 → 第 7 个 429；本地模式不限。
- [ ] **步骤 3：写失败测试** `model-key-store.test.ts`（jsdom）：`set` 后 `localStorage['vl-model']` 有值；`clear` 后移除；`modelHeaderValue()` 可被 `parseModelHeader` 还原。
- [ ] **步骤 4：运行** 三个文件 → FAIL。
- [ ] **步骤 5：实现**；`ModelKeyStatus` 组件：线上模式显示「模型 Key：未填写 / 已保存在本浏览器」，链接到设置；本地模式显示「模型：<model>」。
- [ ] **步骤 6：运行** `pnpm test` → 全部 PASS。
- [ ] **步骤 7：提交** `git commit -m "🔒 线上模式模型 Key 只存浏览器与服务器内存，新增生成配额"`

---

### 任务 5：任务事件流（SSE）与 Agent 轨迹

**文件：**
- 新建：`job-stream.ts`、`trace.ts`
- 修改：`route.ts`（`GET /jobs/{id}/stream`、`GET /jobs/{id}/trace`）
- 测试：`tests/verified-learning/job-stream.test.ts`、`tests/verified-learning/trace.test.ts`

**接口：**
- `jobStreamResponse(open: () => Database, scope: string, jobId: string, after: number, signal: AbortSignal): Response`：`text/event-stream; charset=utf-8`、`cache-control: no-store`、`x-accel-buffering: no`。每 1000ms 读 `JobStore.events(scope, jobId, cursor)`，每个事件发 `id: <cursor>\nevent: progress\ndata: <JSON {cursor,stage,message,createdAt}>\n\n`；同时发 `event: job` + `JobView`（状态变化时）；15s 无事件发 `: ping`；任务终态且事件读尽后发 `event: end` 并关闭；`signal` 中止时清理定时器与数据库连接。`after` 取 `Last-Event-ID` 头优先，其次 `?after=`。
- `buildTrace(db, scope, jobId): TraceView`：
  ```ts
  interface TraceStep { at: number; tool: string; label: string; ok: boolean;
    read?: { sourceId: string; chapterId: string; from: number; to: number };
    search?: string; cites?: { sourceId: string; paragraphIndex: number }[]; section?: string; question?: number; error?: string }
  interface TraceView { stages: { stageId: string; requests: number; steps: TraceStep[] }[]; sources: { sourceId: string; title: string; paragraphs: number }[] }
  ```
  从 `messages_json` 中 assistant 的 `toolCall`（取 name/arguments）与对应 `toolResult`（取 `isError` 与前 120 字错误）配对。`read_source` 的段落区间：取返回结果中 `paragraphs[].paragraphIndex` 的最小/最大（结果被截断时退回 offset..offset+limit−1）。只保留规格允许字段：**丢弃** `submit_question` 的题目内容（只保留题号）、所有 `markdown`、`quote`、`answer`、`explanation`、`referenceCode`、`tests`、系统提示、assistant 文本。`sources` 列出该任务涉及来源的标题与总段数（来自 `vl_source_revisions` 快照）。
- 已用真实数据验证可行：课件任务 21 次工具调用全带参数（见规格 8.2）。

- [ ] **步骤 1：写失败测试** `job-stream.test.ts`：
  - 终态任务：响应在 2 秒内结束，正文含全部历史 `progress` 事件与 `event: end`；
  - `Last-Event-ID: 3` → 只推 cursor > 3；
  - 运行中任务追加事件后 1.5s 内推出；中止 `signal` 后不再查询（spy `events` 调用次数不再增长）；
  - 未登录 401；其他空间 404。
- [ ] **步骤 2：写失败测试** `trace.test.ts`：用构造的 `messages_json`（含 `read_source`、`search_sources`、`submit_lesson_section`、一个 `isError` 结果、`submit_question` 带答案）→ 输出步骤数、读取区间、引用段号正确；序列化结果不含 `answer`、`explanation`、`markdown`、`quote`、`referenceCode` 字样与题干。
- [ ] **步骤 3：运行** → FAIL。
- [ ] **步骤 4：实现**。
- [ ] **步骤 5：运行** `pnpm test` → 全部 PASS。
- [ ] **步骤 6：提交** `git commit -m "✨ 新增任务事件 SSE 流与脱敏 Agent 执行轨迹接口"`

---

### 任务 6：AI 助教对话接口

**文件：**
- 新建：`tutor.ts`
- 修改：`route.ts`（`POST /sessions/{id}/tutor`，读请求头 Key）
- 测试：`tests/verified-learning/tutor.test.ts`

**接口：**
- 请求体：`{ messages: UIMessage[]（最多 20 条，单条文本 ≤ 4000 字）, runId?: string, selection?: { sourceId: string; chapterId: string; paragraphIndex: number; text: string } }`。
- `buildTutorContext(db, scope, sessionId, runId?): { system: string; sources: SourceSnapshot[] }`：系统提示含课程目标、当前知识点标题、当前课件 Markdown（截断 12,000 字）与其引用列表；**当前活动存在未完成作答的题目时，不加入任何题目的 answer/explanation，并在提示中写明「不要直接给出当前练习题的答案，可以讲解概念并引导」**；已作答完成的题可加入解析。来源 = 课程版本 `sourceRevisions` 对应快照（含联网补充来源）。
- `tutorResponse(...)`：`streamText({ model, system, messages: convertToModelMessages(messages), tools: { search_sources, read_source }（复用 createSourceTools 的执行逻辑，用 ai 的 tool() 包装）, stopWhen: stepCountIs(6), abortSignal })` → `toUIMessageStreamResponse()`。模型：本地用设置（`getModel()`），线上用请求头配置（`createOpenAICompatible`/`createAnthropic`）。回答要求以 `〔来源ID·第N段〕` 格式标注出处（前端解析为朱批出处）。
- 对话不写数据库。

- [ ] **步骤 1：写失败测试** `tutor.test.ts`（`MockLanguageModelV4` from `ai/test`）：
  - 当前 run 有未作答题 → `buildTutorContext().system` 不含该题 `answer` 与 `explanation`，含「不要直接给出」；作答完成后含解析；
  - 流式响应 200，`content-type` 为 UI message stream，正文含模型文本；
  - 工具调用 `read_source` 只能读本课程来源：传其他空间的 `sourceId` → 工具结果为错误；
  - 线上模式无 `X-VL-Model` → 400 `MODEL_KEY_REQUIRED`；消息超过 20 条 → 400。
- [ ] **步骤 2：运行** → FAIL。
- [ ] **步骤 3：实现**。
- [ ] **步骤 4：运行** `pnpm test` → 全部 PASS。
- [ ] **步骤 5：提交** `git commit -m "✨ 新增学习助教流式对话接口，作答期间不泄露答案"`

---

### 任务 7：朱批标志组件

**文件：**
- 新建：`src/lib/roadmap.ts`、`src/lib/tape.ts`、`src/components/zhupi/{grade-mark,roadmap,tape,citation-note,source-drawer}.tsx`
- 测试：`tests/frontend/roadmap.test.ts`、`tests/frontend/tape.test.ts`、`tests/frontend/zhupi.test.tsx`

**接口：**
- `layoutRoadmap(points: { id: string; title: string; prerequisiteIds: string[]; role: 'target'|'prerequisite'|'supplement' }[]): { columns: { id: string; row: number }[][]; depth: Map<string, number>; rows: number }`：层号 = 最长先修链长度；层内按其先修在上一层行号的平均值排序（第 0 层保持输入顺序）；行号以 0.5 为步长居中（参照 `d-course.html` 的算法）；先修指向不存在的 id 时忽略该边；有环时抛 `Error('先修关系存在循环')`。
- `ancestors(points, id): Set<string>`（含自身）。
- `mergeRanges(ranges: [number, number][]): [number, number][]`（排序合并重叠与相邻区间）。
- `<GradeMark kind="ok"|"no"|"void"|"pending" size? animate? />`：SVG 笔画（参照样张路径），`animate` 时 `stroke-dashoffset` 300ms 描画，`aria-label` 分别为「答对」「答错」「答错，不计入」「待作答」。
- `<Roadmap points evidence={Record<id, ('ok'|'no')[]>} current? onOpen(id) />`：HTML 网格节点 + SVG 连线（`ResizeObserver` 重排）；节点为 `<button>`，悬停/聚焦高亮祖先链；宽度不足 `cols × 9.75rem` 时容器横向滚动；`< 760px` 渲染按层分组列表；节点 `aria-label` 形如「变量与数值运算，先修，计入证据 0 题」。
- `<Tape total reads={[from,to][]} cites={number[]} label />`：灰色读取区间 + 朱批细线；`aria-label` 写明读取段数与引用段数。
- `<CitationNote source paragraphIndex quote onOpen />`：旁注样式（朱批「教材 · 第 761 段」+ 宋体引文），按钮可聚焦。
- `<SourceDrawer open sourceId revision chapterId paragraphIndex onClose />`：Radix Dialog 右侧抽屉，分页加载原文（`GET /textbooks/{id}/chapters/{chapterId}?revision=&offset=`，offset 取 `paragraphIndex` 所在页），滚动到目标段并朱批高亮；Esc 关闭。

- [ ] **步骤 1：写失败测试** `roadmap.test.ts`：用真实 18 点课程数据（从 `.superpowers/brainstorm/frontend-redesign/course-points.json` 抄入测试夹具）→ 7 层；第 1 层仅 `py-hello-print`；`algo-greedy` 在第 7 层；`ancestors('algo-bfs')` 含 `py-hello-print`；环 → 抛错；悬空先修被忽略。
- [ ] **步骤 2：写失败测试** `tape.test.ts`：`mergeRanges([[680,699],[690,710],[728,747],[748,767]])` → `[[680,710],[728,767]]`。
- [ ] **步骤 3：写失败测试** `zhupi.test.tsx`（jsdom + Testing Library）：`GradeMark` 四种 aria-label；`Roadmap` 渲染 18 个按钮、聚焦某节点后其祖先节点带 `data-lit`；窄屏模式渲染层级列表。
- [ ] **步骤 4：运行** → FAIL。
- [ ] **步骤 5：实现**。
- [ ] **步骤 6：运行** `pnpm vitest run tests/frontend` → PASS。
- [ ] **步骤 7：提交** `git commit -m "💄 新增朱批标志组件：批改标记、先修路线图、书带、出处旁注与原文抽屉"`

---

### 任务 8：首页、教材库、教材详情

**文件：**
- 新建：`src/app/(app)/page.tsx`（替换占位）、`library/page.tsx`、`library/[bookId]/page.tsx`、`src/components/library/*`、`src/components/home/*`
- 测试：`tests/e2e/library.spec.ts`（Playwright，接口用 `page.route` 模拟）

**页面要点（规格第 7 节）：**
- 首页：h1「今天从哪继续」；有课程时显示最近课程的 `Roadmap` 缩略（只读，节点不可点，最多 8 个层级标题）+ 下一步；未完成草稿（最多 4 行，「全部草稿」）；运行中任务（`useJobStream` 实时）；无任何数据时显示三步引导（上传教材 → 写目标 → 生成），每步一个按钮。
- 教材库：h1「教材库」；拖拽区（`<input type=file>` + 拖放，接受 `.txt,.md,.markdown,.epub,.pdf,.docx,.mobi,.azw3`，大小上限取 `GET /mode` 的 `uploadLimitBytes`，旁注写明）；上传中显示文件名与「正在解析」；表格行：书名、格式、章数、段数、被引用（课程/草稿数，来自 `GET /textbooks/{id}/deletion` 的 blockers 计数，懒加载）、导入时间、操作（归档/恢复）；搜索框 + 「显示已归档」开关；同一文件重试复用幂等键。
- 教材详情：h1 书名；左栏目录（章节列表，当前章高亮）；中间原文（宋体正文，段号在左侧灰色，`#p-<index>` 可直接定位并朱批高亮，分页「继续加载」）；右栏：书带（引用此书的课件段落，`GET /jobs` 中相关任务的 trace 合并；无则隐藏）+ 归档/彻底删除（删除需输入书名，展示影响列表，规格 7）。

- [ ] **步骤 1：写失败的端到端测试** `library.spec.ts`：
  - 空库首页显示三步引导，点击「上传教材」跳到 `/library`；
  - 上传 `.md`（模拟 201）后列表出现该书；超过上限的文件被拒并提示上限；
  - 教材详情 `/library/b1#p-120` 打开后第 120 段可见且带高亮属性；
  - 删除对话框：书名不一致时「确认删除」不可用；有引用时显示阻塞列表且不显示删除按钮。
- [ ] **步骤 2：运行** `pnpm exec playwright test tests/e2e/library.spec.ts` → FAIL。
- [ ] **步骤 3：实现**（Playwright 配置 `playwright.config.ts`：`webServer` 用 `pnpm dev`，本地模式环境变量与临时 DB；Chromium 使用本机已安装的 revision 1228）。
- [ ] **步骤 4：运行** → PASS。
- [ ] **步骤 5：设计检查** `node <skill>/scripts/inspect.mjs http://127.0.0.1:3101/library --app` 等三页 → 0 FAIL；看 1440/390 截图修前三个问题。
- [ ] **步骤 6：提交** `git commit -m "💄 重写首页、教材库与教材详情页"`

---

### 任务 9：草稿列表与草稿编辑

**文件：**
- 新建：`drafts/page.tsx`、`drafts/[draftId]/page.tsx`（状态分派壳）、`src/components/drafts/{draft-list,draft-editor,step-goal,step-sources,step-teaching,step-assessment,save-indicator}.tsx`
- 测试：`tests/e2e/drafts.spec.ts`

**要点：**
- 草稿页按 `draft.state` 渲染：`editing` → 编辑器；`generating` → 任务 10 的生成视图；`review` → 任务 10 的审核视图；`confirmed` → 「课程已创建」+ 进入学习。
- 编辑器四步（同页纵向四个分区，左侧步骤目录随滚动高亮，不做分页向导）：① 目标与标题；② 资料与章节（教材选择、章节勾选 + 全选、最多 4 本，第一本为主教材）；③ 教学要求（教学方案单选、编程语言（计算机类）、额外要求、已有基础、包含/排除主题、允许联网补充）；④ 考核（三类题量 1–50、难度、学习模式）。
- 自动保存：沿用 `DraftSaveQueue`（`src/lib/verified-learning/draft-editor.ts`）与 800ms 防抖；`SaveIndicator`：编辑中 / 保存中 / 已保存 / 保存失败（重试）/ 冲突（「加载服务器版本」按钮）。
- 生成按钮区：`generationProblems(input)` 的每条阻塞原因逐行列出；线上模式未填 Key 时显示「先在设置中填写模型 Key」并链接设置；点击生成先 flush 再 `POST /drafts/{id}/generate`（`modelHeader: true`）。

- [ ] **步骤 1：写失败的端到端测试** `drafts.spec.ts`（沿用 `scripts/check-unified-ui.cjs` 的模拟方式）：
  - 输入目标后 800ms 内发出一次 PATCH，指示器显示「已保存」；PATCH 返回 409 时显示冲突提示且不覆盖本地输入；
  - 未选章节时生成按钮禁用并列出「主教材至少选择一章」；
  - 线上模式（`GET /mode` 返回 online）未填 Key 时生成按钮禁用并有设置链接；填写后点击生成，请求头含 `x-vl-model`；
  - 草稿列表「丢弃」需确认对话框。
- [ ] **步骤 2：运行** → FAIL。
- [ ] **步骤 3：实现**。
- [ ] **步骤 4：运行** → PASS；设计检查两页 0 FAIL。
- [ ] **步骤 5：提交** `git commit -m "💄 重写课程草稿列表与分区编辑器，保留串行自动保存"`

---

### 任务 10：生成过程视图与方案审核

**文件：**
- 新建：`src/components/drafts/{generation-view,review-view,review-roadmap,point-row,final-order}.tsx`、`src/lib/api/use-job-stream.ts`
- 测试：`tests/frontend/use-job-stream.test.ts`、`tests/e2e/generation.spec.ts`

**接口：**
- `useJobStream(jobId: string | null): { job: JobView | null; events: JobEvent[]; connected: boolean }`：`EventSource('/api/verified-learning/v1/jobs/{id}/stream')`，断线由浏览器自动重连（携带 Last-Event-ID）；收到 `end` 关闭并失效 `queryKeys.job/draft/session`；`EventSource` 不可用时退回 2s 轮询 `GET /jobs/{id}` 与 `/events`。
- 生成视图（参照 `b-yingguang.html` 的结构、`a-zhupi.html` 的配色）：h1「正在生成课程方案」；数字带（读取原文次数、搜索次数、已提交知识点、校验修正次数——由 trace 计数）；左侧执行记录（倒序，`motion` 淡入新行，时间用 `HH:mm:ss`）；右侧每本来源一条 `Tape`（trace 的 read 区间 + cites）；底部「停止生成」（确认对话框）。任务失败：显示错误原文（可展开），`resumable` 时「继续任务」按钮（线上模式需 Key，`modelHeader: true`）；错误码 `MODEL_KEY_REQUIRED` 时文案「服务器已重启，模型 Key 只保存在你的浏览器。确认设置中的 Key 后点继续」。trace 每收到 5 个事件或任务结束时刷新一次。
- 审核视图：h1「核对课程方案」；顶部问题列表（`ISSUE_LABEL` 中文）；主体 `Roadmap`（节点按 `planCourse` 状态标记：学习目标墨框、自动先修细框、已掌握灰底、排除删除线）；点节点打开右侧面板 `PointRow`（设为目标/已掌握/排除互斥、先修调整 + 必填原因、引用条数与「查看出处」打开 `SourceDrawer`）；补充来源逐个认可；`FinalOrder` 列表（上移/下移按钮，`canMove` 约束）；底部「保存并校验」「我已核对来源覆盖与先修关系」勾选、「确认并创建课程」。行为与 `review-panel.tsx`（标签 `frontend-v1-backup`）一致：脏数据先保存校验、有问题不可确认、过期方案提示「使用这次生成对应的输入 / 返回编辑」。

- [ ] **步骤 1：写失败测试** `use-job-stream.test.ts`（jsdom，伪造 `EventSource`）：收到 progress 追加事件；收到 end 关闭连接；无 EventSource 时调用轮询。
- [ ] **步骤 2：写失败的端到端测试** `generation.spec.ts`：
  - 模拟 SSE（`page.route` 返回 `text/event-stream` 正文）：执行记录逐条出现，书带出现朱批线；
  - 任务失败且 `MODEL_KEY_REQUIRED`：显示「服务器已重启」文案与「继续任务」；
  - 审核：把一个点设为排除导致先修缺失 → 保存后显示「排除了必需的先修知识点」且确认按钮禁用；勾选核对后确认 → 跳转 `/learn/<sessionId>`。
- [ ] **步骤 3：运行** → FAIL。
- [ ] **步骤 4：实现**。
- [ ] **步骤 5：运行** → PASS；设计检查两种状态 0 FAIL。
- [ ] **步骤 6：提交** `git commit -m "✨ 新增实时生成过程视图（SSE + 书带）并重写方案审核"`

---

### 任务 11：课程列表与课程主页

**文件：**
- 新建：`courses/page.tsx`、`courses/[courseId]/page.tsx`、`src/components/courses/{course-row,course-header,kpi-strip,next-step,recent-activity,source-panel,notes-tab,history-tab,sources-tab,generation-tab}.tsx`
- 测试：`tests/e2e/courses.spec.ts`

**要点（以 `d-course.html` 为准）：**
- 课程列表：行（目标、掌握进度条 `已验证 n / 总数`（朱批填充，真实比例）、下一步文字、最近学习时间、「继续学习」）；空状态链接到草稿。
- 课程主页：`?versionId=` 缺省取课程最新版本。标题区（面包屑、h1 课程名、目标 + 朱批「下一步」一句、按钮「回看课件」「继续学习」）；标签页（Radix Tabs，URL `?tab=`）：路线图 / 笔记 / 历史回看 / 资料来源 / 生成过程。
  - 路线图：`KpiStrip`（已验证掌握、已完成活动、计入证据的作答、课件出处——数值全部来自 `GET /progress` 与课件引用计数）+ `Roadmap`（evidence 来自 progress 的知识点作答记录；后端当前只返回 verified 列表与总作答数，若无逐点最近 5 题数据，则在 `RecordService.progress` 增加 `recent: Record<pointId, boolean[]>`（最近 5 道计入证据的不同题，排除看过 4 级提示的）——在任务内补后端测试 `progress.test.ts`）+ 下方三栏 `NextStep`（session.next 的三种情况：活动 / 阻塞（先修自报或补练）/ 完成）、`RecentActivity`（history 前 3 条）、`SourcePanel`（每个来源一条 Tape，数据合并该课程全部内容任务的 trace）。
  - 笔记：按知识点分组的笔记列表、编辑（修订号冲突提示）、导出 Markdown、新建。
  - 历史回看：同任务 12 历史页的列表组件（复用）。
  - 资料来源：来源表（标题、类型（上传/联网补充）、段数、被引用次数、链接到教材详情）。
  - 生成过程：该课程方案生成任务的执行记录与书带（复用任务 10 组件，只读）。

- [ ] **步骤 1：写失败的后端测试** `tests/verified-learning/progress-recent.test.ts`：`progress().recent[pointId]` 为最近 5 道计入证据的不同题的对错数组，按时间先后；看过 4 级提示的题不计入；与 `verified()` 判定一致（同一夹具下 `recent` 满足条件的点 = verified 列表）。
- [ ] **步骤 2：写失败的端到端测试** `courses.spec.ts`：课程主页渲染 18 个路线图节点；print() 节点显示「答错」「答对」两个标记；`?tab=notes` 直接打开笔记；新建笔记后出现在列表；进度条宽度比例等于 verified/总数。
- [ ] **步骤 3：运行** → FAIL。
- [ ] **步骤 4：实现**。
- [ ] **步骤 5：运行** `pnpm test` 与该 spec → PASS；设计检查 0 FAIL，1440/1920/390 截图与 `d-course.html` 对照。
- [ ] **步骤 6：提交** `git commit -m "💄 重写课程列表与课程主页（先修路线图为主体）"`

---

### 任务 12：学习页（课件、答题、助教）与历史回看

**文件：**
- 新建：`learn/[sessionId]/page.tsx`、`learn/[sessionId]/history/page.tsx`、`src/components/learn/{learn-layout,course-toc,lesson-article,lesson-markdown,question-set,question-choice,question-fill,question-code,hint-ladder,evidence-bar,tutor-panel,next-panel,mode-switch}.tsx`、`src/lib/stores/tutor-history.ts`、`src/lib/citations.ts`
- 测试：`tests/frontend/citations.test.ts`、`tests/frontend/tutor-history.test.ts`、`tests/e2e/learn.spec.ts`

**接口：**
- `src/lib/citations.ts`：
  - `attachCitations(markdown: string, citations: CitationView[]): { blocks: Block[] }`——把每个引用的 `quote` 在课件正文中定位（先精确匹配，再去空白匹配），返回段落块与该块关联的引用列表；找不到位置的引用归入该小节末尾的「本节出处」。不改动 Markdown 原文。
  - `parseTutorCitations(text: string): ({ type: 'text'; text: string } | { type: 'cite'; sourceId: string; paragraphIndex: number })[]`——解析 `〔来源ID·第N段〕`。
- `useTutorHistory(sessionId)`：zustand `persist`（键 `vl-tutor-<sessionId>`），保留最近 40 条消息。

**要点（以 `a-zhupi.html` 为准，铺满三栏）：**
- 布局：左栏 `CourseToc`（路线图的层级列表形式，当前知识点朱批点，已验证掌握的打勾）；中间纸面；右栏按内容切换：课件时为旁注栏（`CitationNote` 与正文段落顶端对齐），点「问助教」切到 `TutorPanel`。≥1440 三栏；1024–1439 右栏收为可开关抽屉；<1024 单栏，旁注变为段后小字。
- 课件：`LessonArticle` 宋体正文（`react-markdown` + `remark-math`/`rehype-katex`，不执行 HTML；代码块用 `shiki` 高亮：服务端组件不可用于客户端 Markdown 时，改为客户端按需 `import('shiki')`——在账本记录实际做法）；引用句子朱批细下划线；页头 meta（小节数、字数、出处数与来源构成、生成耗时与读原文次数——来自 run 对应任务的 trace）；`EvidenceBar`（本知识点证据批改条，同样张 A）；文末「我读完了」。
- 题组：每题一张纸面；选择（Radix RadioGroup）、填空、编程（CodeMirror：Python/JavaScript/C，显示公开样例）；`HintLadder` 四级，第 4 级确认对话框；提交后 `GradeMark` 落笔动画 + 解析；判题中（编程题轮询 attempt）；判题故障「不计为答错」+ 恢复按钮。作答位置自动保存（沿用 cursor 接口，1s 防抖）。
- 下一步/阻塞/完成三种状态面板（同课程主页 `NextStep`，复用）。生成中：复用任务 10 生成视图的紧凑版。
- 模式切换：Radix ToggleGroup（理论/练习/刷题），有进行中活动时确认放弃。
- `TutorPanel`：`useChat`（`@ai-sdk/react`，`DefaultChatTransport({ api: '/api/verified-learning/v1/sessions/<id>/tutor', headers: () => 线上模式的 X-VL-Model, body: { runId, selection } })`）；流式文本 + 闪烁光标；解析出处渲染为可点击朱批出处（打开 `SourceDrawer`）；选中课件文本后浮出「就这段提问」；线上无 Key 时输入框禁用并提示去设置。
- 历史回看：时间线（活动类型、状态、时间），点开只读查看课件（同 `LessonArticle`）与作答记录（含答案与解析）。

- [ ] **步骤 1：写失败测试** `citations.test.ts`：用开发库真实课件片段（「在 Python 里，这个工具就是内置函数 `print()`。」与其引用）→ 引用落在正确块；不存在的 quote 进入「本节出处」；`parseTutorCitations('见〔web:aaea·第678段〕。')` 正确拆分。
- [ ] **步骤 2：写失败测试** `tutor-history.test.ts`：追加 45 条只保留 40 条；不同 sessionId 互不影响。
- [ ] **步骤 3：写失败的端到端测试** `learn.spec.ts`：
  - 课件页：点击旁注打开原文抽屉并定位第 761 段；「我读完了」后进入下一活动；
  - 题组：选择题提交后出现「答对」标记与解析；第 4 级提示需确认，确认后显示解析；编程题判题中 → 完成；
  - 助教：模拟 UI message stream 响应，回答逐步出现，出处可点击；作答中提问的请求体含 `runId`；
  - 1024px 宽度右栏变为抽屉，390px 单栏且旁注在段后。
- [ ] **步骤 4：运行** → FAIL。
- [ ] **步骤 5：实现**。
- [ ] **步骤 6：运行** → PASS；设计检查（课件态、题组态、助教展开）0 FAIL。
- [ ] **步骤 7：提交** `git commit -m "✨ 重写学习页：朱批旁注课件、批改题组与流式助教，重写历史回看"`

---

### 任务 13：设置页

**文件：**
- 新建：`settings/page.tsx`、`src/components/settings/{provider-form,model-picker,key-notice,judge-status}.tsx`
- 测试：`tests/e2e/settings.spec.ts`

**要点：**
- 本地模式：同第一版功能（供应商协议、Base URL、API Key（留空保持）、Embedding 三项、拉取模型列表、手填模型名、保存到服务器），按规格 8.2 版式：左列标题与说明、右列表单纸面；保存一个按钮。
- 线上模式：同一表单，但「保存」写入浏览器（`useModelKey.set`），不请求 `PATCH /settings`；顶部 `KeyNotice`：「Key 只保存在这个浏览器里，服务器不写入任何文件。共用电脑用完请点清除。」+「清除 Key」按钮（确认）。拉取模型列表请求带 `X-VL-Model`。Embedding 字段隐藏（当前未使用）。
- `JudgeStatus`：`GET /judge` 成功 → 列出可用语言；失败 → 「判题服务未配置：编程题无法生成和判分，选择题、填空题不受影响」。

- [ ] **步骤 1：写失败的端到端测试** `settings.spec.ts`：本地模式保存发出 PATCH；线上模式保存不发 PATCH 且 `localStorage['vl-model']` 有值；清除后为空；拉取模型列表失败显示错误并允许手填；判题服务 502 时显示未配置说明。
- [ ] **步骤 2：运行** → FAIL。
- [ ] **步骤 3：实现**。
- [ ] **步骤 4：运行** → PASS；设计检查 0 FAIL。
- [ ] **步骤 5：提交** `git commit -m "💄 重写设置页，线上模式 Key 只存浏览器"`

---

### 任务 14：示例课程与线上空间初始化

**文件：**
- 新建：`sample-course.ts`、`scripts/sample-export.ts`、`data/sample/README.md`（说明，JSON 本体不入库）
- 修改：`online-access.ts`（新建空间后调用 `seedSample`）、`package.json` 脚本 `"vl:sample-export": "tsx scripts/sample-export.ts"`
- 测试：`tests/verified-learning/sample-course.test.ts`

**接口：**
- `exportSample(db, fromScope: string, courseId: string): SampleBundle`：导出该课程活跃版本涉及的 `vl_books`、`vl_source_revisions`、`vl_course_versions`、`vl_course_reviews`、`vl_study_sessions`（新建一个干净会话状态，不带作答）、已完成的 `vl_activity_runs`（课件与题组内容）、`vl_questions`、生成该课程/课件/题组的 `vl_jobs`（只保留终态与结果，`input_json` 置为 `{}`）、`vl_job_events`、`vl_agent_states`（`messages_json` 经 `buildTrace` 同等脱敏后仅保留工具调用与结果状态；或直接存 trace JSON——任选其一并在账本记录）；不导出作答、提示、笔记。
- `seedSample(db, scope: string, bundle: SampleBundle): void`：单事务；所有 ID 保留原值（表主键均含 `scope_id`，不同空间不冲突）；`vl_spaces.sample_seeded = 1`；重复调用幂等。
- 示例文件路径由 `VL_SAMPLE_PATH` 指定；未配置或文件不存在时跳过（线上站仍可用，只是没有示例）。

- [ ] **步骤 1：写失败测试** `sample-course.test.ts`：用 faux 模型在空间 `template` 生成一门小课程（教材 → 草稿 → 方案 → 确认 → 课件 → 题组）；导出后种入空间 `s1`：`s1` 的课程列表 1 门，课件内容与引用一致，题目可作答（提交答案得到判分），生成过程 trace 可读；`s1` 作答不影响 `template`；再种一次不重复；导出的 JSON 不含任何作答与 `input_json` 原文。
- [ ] **步骤 2：运行** → FAIL。
- [ ] **步骤 3：实现**。
- [ ] **步骤 4：运行** `pnpm test` → PASS。
- [ ] **步骤 5：提交** `git commit -m "✨ 新增示例课程导出与新空间自动种入"`

> 真实示例课程（Python 官方中文教程 + OI Wiki）需要一次真实生成，会产生模型费用：**执行前单独征得用户同意**（规格 13）。本任务只交付机制与测试。

---

### 任务 15：安全头、部署文件与整体验收

**文件：**
- 新建：`src/proxy.ts`、`deploy/nginx.conf.example`、`deploy/zhixueban.service`、`deploy/judge0/docker-compose.yml`、`deploy/env.example`、`deploy/README.md`、`scripts/check-key-leak.ts`
- 修改：`docs/verified-learning/frontend-handoff.md`（新路由与新接口）、`README`（如无则不新增，改写交接文档即可）
- 测试：`tests/e2e/a11y.spec.ts`、`tests/e2e/online-flow.spec.ts`

**要点：**
- `src/proxy.ts`：所有页面响应加 `Content-Security-Policy`（`default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`，开发模式加 `'unsafe-eval'`）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`；按 Next 文档生成 nonce 并透传 `x-nonce`。`matcher` 排除 `/_next/static`、`/_next/image`、`/api`、`favicon.ico`。（`style-src 'unsafe-inline'` 的理由：Radix 与 motion 写内联样式；记入账本。）
- `deploy/`：Nginx（HTTPS、`proxy_buffering off` 用于 `/api/verified-learning/v1/jobs/`、`client_max_body_size 21m`、`proxy_set_header X-Real-IP`、HTTP→HTTPS 跳转）、systemd 单元（`next start -p 3101 -H 127.0.0.1`，`Environment=VL_MODE=online` 等，`KillSignal=SIGTERM`、`TimeoutStopSec=30`）、Judge0 compose（官方 1.13.x 配置，网络隔离，`enable_network: false` 默认值，仅监听 127.0.0.1）、环境变量清单与运维说明（备份 `data/`、日志不记录请求头、升级步骤）。需要管理员权限的步骤写在 README 里由用户执行。
- `scripts/check-key-leak.ts <db> <dir...> --key <value>`：对数据库文件、WAL、上传目录与日志目录做字节级全文搜索，输出命中数。
- `a11y.spec.ts`：对 13 个页面（模拟数据）跑 axe，`serious`/`critical` 违规为 0；Tab 键遍历每页主要控件均可达且焦点可见。
- `online-flow.spec.ts`（线上模式启动、模拟模型）：登录 → 首页示例课程 → 设置填 Key → 上传 → 草稿 → 生成（SSE）→ 审核 → 学习 → 答题 → 课程主页进度更新；结束后运行 `check-key-leak` 结果为 0。

- [ ] **步骤 1：写失败的端到端测试** `a11y.spec.ts`、`online-flow.spec.ts`。
- [ ] **步骤 2：运行** → FAIL。
- [ ] **步骤 3：实现** `proxy.ts`、部署文件、`check-key-leak.ts`。
- [ ] **步骤 4：运行全部验收**：
  - `pnpm test` → 全部 PASS；
  - `pnpm exec tsc --noEmit --incremental false` → 0 错误；
  - `pnpm lint` → 0 错误；
  - `pnpm build` → 成功；
  - `pnpm exec playwright test` → 全部 PASS；
  - `node <skill>/scripts/lint.mjs --app src/app src/components` 与生产构建（`pnpm build && pnpm start`）上的 `inspect.mjs --app` 对 13 个页面 1440/768/390 → 0 FAIL；看截图按 `critique.md` 打分修前三个问题（最多三轮）。
- [ ] **步骤 5：更新交接文档**（新路由表、新接口：`/mode`、`/jobs/{id}/stream`、`/jobs/{id}/trace`、`/sessions/{id}/tutor`、`X-VL-Model`、线上环境变量）。
- [ ] **步骤 6：提交** `git commit -m "🚀 新增安全响应头与线上部署文件，完成整体验收"`

---

## 自审记录

- **规格覆盖**：第 2 节目标 1–5 → 任务 1、7–13（页面）、5、6、10、12（AI 流式）、3、4、14（线上）、15（无障碍与三宽度）；第 6 节视觉 → 任务 1（令牌字体）、7（标志组件）；第 7 节 13 个页面 → 任务 8–13（登录在任务 1）；第 8.1–8.5 → 任务 5、5、6、3/4/14、4；第 9 节安全 → 任务 3、4、5、6、15；第 10 节部署 → 任务 15；第 11 节验收 → 每任务 + 任务 15。
- **类型一致**：`ModelConfig`（任务 4）被任务 6、12、13 使用；`TraceView`（任务 5）被任务 10、11、12、14 使用；`useJobStream`（任务 10）被任务 8、11、12 使用；`Roadmap`/`Tape`/`GradeMark`/`CitationNote`/`SourceDrawer`（任务 7）被任务 8、10、11、12 使用；`progress().recent`（任务 11）被任务 11、12 使用。
- **已知取舍**：`style-src 'unsafe-inline'`（Radix/motion 内联样式）；`shiki` 在客户端按需加载；后端新增 `recent` 字段属于前端需要的查询扩展，不改变掌握判定语义。
