import { randomUUID } from 'node:crypto';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getModel } from '@/lib/llm/provider';
import { loadSubjectPrompt } from '@/lib/llm/prompts';

export interface OutlineNode {
  kpId: string;
  depth: 'brief' | 'normal' | 'deep';
}

export interface ComposedCourse {
  id: string;
  outline: OutlineNode[];
  gaps: string[];
  review: { kept: string[]; excluded: string[]; reorderReason: string; supplements: string[] };
}

export interface QuizConfig {
  perKnowledgePoint?: number; // 每知识点题数，默认 3
  perChapter?: number; // 章测题数，默认 10
  finalCount?: number; // 综合大题数，默认 10
  passThreshold?: number; // 边学边练达标阈值 0-1，默认 0（做完即解锁）
}

export interface ComposeCourseInput {
  textbookId: string;
  goal: string;
  goalPrompt: string;
  subjectType: string;
  mode: 1 | 2 | 3;
  quizConfig?: QuizConfig;
}

/** 全图拓扑排序后过滤到大纲内节点：跨越被排除节点的传递依赖也能保持先后 */
function topoSort(allIds: string[], edges: { fromId: string; toId: string }[], inScope: Set<string>): string[] {
  const indegree = new Map<string, number>(allIds.map((id) => [id, 0]));
  for (const e of edges) {
    indegree.set(e.toId, (indegree.get(e.toId) ?? 0) + 1);
  }
  const queue = allIds.filter((id) => indegree.get(id) === 0);
  const result: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (inScope.has(cur)) result.push(cur);
    for (const e of edges) {
      if (e.fromId === cur) {
        const d = indegree.get(e.toId)! - 1;
        indegree.set(e.toId, d);
        if (d === 0) queue.push(e.toId);
      }
    }
  }
  return result;
}

/**
 * 目标驱动课程生成：学习约定 + 学科提示词注入，
 * 模型通过 submitCourseOutline 工具提交大纲与教材缺口，本地拓扑校验修正顺序。
 */
export async function composeCourse(input: ComposeCourseInput): Promise<ComposedCourse> {
  const db = getDb();
  const points = db
    .prepare('SELECT id, title, chapter_ref FROM knowledge_points WHERE textbook_id = ?')
    .all(input.textbookId) as { id: string; title: string; chapter_ref: string }[];
  const edges = db
    .prepare(
      `SELECT e.from_id AS fromId, e.to_id AS toId FROM knowledge_edges e
       JOIN knowledge_points p ON p.id = e.from_id WHERE p.textbook_id = ?`,
    )
    .all(input.textbookId) as { fromId: string; toId: string }[];
  if (points.length === 0) throw new Error('请先生成知识图谱');

  let outline: OutlineNode[] = [];
  let gaps: string[] = [];
  let review = { kept: [] as string[], excluded: [] as string[], reorderReason: '', supplements: [] as string[] };

  const tools = {
    submitCourseOutline: tool({
      description: '提交裁剪重排后的课程大纲。以知识点为单位裁剪（不整章删除）；目标要求但教材未覆盖的内容放入 gaps。',
      inputSchema: z.object({
        nodes: z.array(
          z.object({
            kpId: z.string(),
            depth: z.enum(['brief', 'normal', 'deep']).describe('讲解深浅'),
          }),
        ),
        gaps: z.array(z.string()).describe('教材缺口清单：目标要求但教材未覆盖的内容'),
        kept: z.array(z.string()),
        excluded: z.array(z.string()),
        reorderReason: z.string(),
        supplements: z.array(z.string()),
      }),
      execute: async (result) => {
        outline = result.nodes;
        gaps = result.gaps;
        review = {
          kept: result.kept,
          excluded: result.excluded,
          reorderReason: result.reorderReason,
          supplements: result.supplements,
        };
        return { ok: true };
      },
    }),
  };

  const kpList = points.map((p) => `${p.id}｜${p.title}`).join('\n');
  const edgeList = edges.map((e) => `${e.fromId} → ${e.toId}`).join('\n');

  await generateText({
    model: getModel(),
    tools,
    stopWhen: stepCountIs(5),
    prompt: `${loadSubjectPrompt(input.subjectType)}

【学习约定】
学习目标：${input.goal}
学习者基础与教学要求：${input.goalPrompt || '未说明'}

【教材知识点】
${kpList}

【前置依赖】
${edgeList || '（无）'}

请根据学习约定对知识点做裁剪与重排，调用 submitCourseOutline 提交：
- nodes：保留的知识点与讲解深浅（目标内的展开更细，不学的排除；被排除章节中首次出现的必要前置知识点须保留）
- gaps：目标要求但教材未覆盖的缺口
- kept/excluded/reorderReason/supplements：课程确认页要展示的四个清单`,
  });

  if (outline.length === 0) throw new Error('模型未提交课程大纲');

  // 本地拓扑校验：顺序不满足先修依赖时修正
  const validIds = new Set(points.map((p) => p.id));
  const filtered = outline.filter((n) => validIds.has(n.kpId));
  const inScope = new Set(filtered.map((n) => n.kpId));
  const sortedIds = topoSort(
    points.map((p) => p.id),
    edges,
    inScope,
  );
  // 拓扑结果遗漏的（如孤点未被访问）按模型原顺序附加
  for (const n of filtered) if (!sortedIds.includes(n.kpId)) sortedIds.push(n.kpId);
  const byId = new Map(filtered.map((n) => [n.kpId, n]));
  const sorted = sortedIds.map((id) => byId.get(id)!);

  const courseId = randomUUID();
  db.prepare(
    `INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    courseId,
    input.textbookId,
    input.goal,
    input.goalPrompt,
    input.subjectType,
    input.mode,
    JSON.stringify({ version: 1, nodes: sorted, gaps, quizConfig: input.quizConfig ?? {}, review }),
    new Date().toISOString(),
  );

  return { id: courseId, outline: sorted, gaps, review };
}
