import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getModel } from '@/lib/llm/provider';
import type { ChapterTree } from '@/lib/textbook/types';

export interface KnowledgeGraph {
  points: { id: string; title: string; chapterRef: string }[];
  edges: { fromId: string; toId: string }[];
}

/** 检查 to 是否可沿已有边到达 from（能则加入 from→to 会成环） */
function reaches(adjacency: Map<string, string[]>, start: string, target: string): boolean {
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adjacency.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/**
 * 知识图谱生成：模型通过工具调用提交结构化内容（不依赖提示词自觉遵守格式）。
 * 工具即 schema：registerKnowledgePoint / registerPrerequisite / finishGraph。
 */
export async function generateKnowledgeGraph(textbookId: string): Promise<KnowledgeGraph> {
  const db = getDb();
  const row = db
    .prepare('SELECT chapter_tree_json FROM textbooks WHERE id = ?')
    .get(textbookId) as { chapter_tree_json: string } | undefined;
  if (!row) throw new Error(`教材不存在：${textbookId}`);
  const tree = JSON.parse(row.chapter_tree_json) as ChapterTree;

  const points: KnowledgeGraph['points'] = [];
  const edges: KnowledgeGraph['edges'] = [];
  const adjacency = new Map<string, string[]>();

  const insertPoint = db.prepare(
    'INSERT OR REPLACE INTO knowledge_points (id, textbook_id, title, chapter_ref) VALUES (?, ?, ?, ?)',
  );
  const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO knowledge_edges (from_id, to_id) VALUES (?, ?)',
  );
  const pointIds = new Set<string>();

  const tools = {
    registerKnowledgePoint: tool({
      description: '注册一个知识点。粒度适中（每章 2-8 个）。',
      inputSchema: z.object({
        id: z.string().describe('短横线英文 ID，如 kp-variable'),
        title: z.string().describe('知识点名称'),
        chapterRef: z.string().describe('所属章节 ID'),
      }),
      execute: async (input) => {
        pointIds.add(input.id);
        points.push(input);
        insertPoint.run(input.id, textbookId, input.title, input.chapterRef);
        return { ok: true };
      },
    }),
    registerPrerequisite: tool({
      description: '注册前置依赖：学习 to 之前必须先掌握 from。只标必要依赖，不得成环。',
      inputSchema: z.object({
        from: z.string().describe('前置知识点 ID'),
        to: z.string().describe('依赖它的知识点 ID'),
      }),
      execute: async (input) => {
        if (!pointIds.has(input.from) || !pointIds.has(input.to)) {
          return { ok: false, reason: '两端知识点须先注册' };
        }
        if (input.from === input.to || reaches(adjacency, input.to, input.from)) {
          return { ok: false, reason: '该边会构成环形依赖，已拒绝' };
        }
        adjacency.set(input.from, [...(adjacency.get(input.from) ?? []), input.to]);
        insertEdge.run(input.from, input.to);
        edges.push({ fromId: input.from, toId: input.to });
        return { ok: true };
      },
    }),
    finishGraph: tool({
      description: '全部知识点与依赖边注册完成后调用。',
      inputSchema: z.object({}),
      execute: async () => ({ ok: true }),
    }),
  };

  const chapterDigest = tree.chapters
    .map((c) => `【${c.id}】${c.title}\n${c.paragraphs.map((p) => p.text).join('\n').slice(0, 2000)}`)
    .join('\n\n');

  await generateText({
    model: getModel(),
    tools,
    stopWhen: stepCountIs(50),
    prompt: `你是课程设计专家。阅读教材《${tree.title}》的章节内容，为全书构建知识图谱：
1. 逐章调用 registerKnowledgePoint 注册知识点
2. 调用 registerPrerequisite 标注前置依赖（只标必要边，不成环）
3. 全部完成后调用 finishGraph

章节内容：
${chapterDigest}`,
  });

  return { points, edges };
}
