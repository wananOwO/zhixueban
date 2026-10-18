import { randomUUID } from 'node:crypto';
import { embed, generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getEmbeddingModel, getModel } from '@/lib/llm/provider';
import { searchChunks } from '@/lib/rag/store';
import { verifyQuestion, type DraftQuestion } from './question-verify';

/** 出题语料：仅限已解锁章节，防止超纲（Review Focus #3） */
export async function buildQuestionCorpus(input: {
  textbookId: string;
  query: string;
  unlockedChapterIds: string[];
}): Promise<string> {
  const db = getDb();
  const { embedding } = await embed({ model: getEmbeddingModel(), value: input.query });
  const chunks = searchChunks(db, input.textbookId, embedding, 20);
  return chunks
    .filter((c) => input.unlockedChapterIds.includes(c.anchor.chapterId))
    .map((c) => c.content)
    .join('\n\n');
}

export interface GenerateQuestionsInput {
  courseId: string;
  scope: 'knowledgePoint' | 'chapter' | 'course' | 'diagnostic' | 'final';
  scopeId: string;
  count: number;
  difficulty: 'easy' | 'medium' | 'hard';
  unlockedKPIds: string[];
  unlockedChapterIds: string[];
}

const DIFFICULTY_DESC = {
  easy: '入门：直接考察单个概念的记忆与理解',
  medium: '中等：需要组合两个概念或一步推理',
  hard: '困难：多步推理与组合运用，但不得超出已学范围',
};

/** 出题：模型经 submitQuestion 工具提交 → 逐题过 verifyQuestion → 合格落库 */
export async function generateQuestions(input: GenerateQuestionsInput) {
  const db = getDb();
  const course = db
    .prepare('SELECT textbook_id AS textbookId FROM courses WHERE id = ?')
    .get(input.courseId) as { textbookId: string } | undefined;
  if (!course) throw new Error('课程不存在');

  const corpus = await buildQuestionCorpus({
    textbookId: course.textbookId,
    query: input.scopeId,
    unlockedChapterIds: input.unlockedChapterIds,
  });

  const submitted: DraftQuestion[] = [];
  const tools = {
    submitQuestion: tool({
      description: '提交一道题。题目必须仅用学习者已学内容可解；code 题必须附 referenceSolution 与 testCases。',
      inputSchema: z.object({
        type: z.enum(['choice', 'fill', 'code']),
        stem: z.string(),
        options: z.array(z.string()).optional(),
        answer: z.string(),
        referenceSolution: z.string().optional(),
        testCases: z.array(z.object({ name: z.string(), assert: z.string() })).optional(),
        rubric: z.string().describe('评分要点'),
        sourceKPIds: z.array(z.string()).describe('本题考察的知识点 ID'),
      }),
      execute: async (q) => {
        submitted.push(q);
        return { ok: true };
      },
    }),
  };

  await generateText({
    model: getModel(),
    tools,
    stopWhen: stepCountIs(input.count + 3),
    prompt: `根据以下已学内容出 ${input.count} 道题（难度：${DIFFICULTY_DESC[input.difficulty]}）。
硬性约束：题目必须仅用以下内容可解，不得涉及任何未给出的知识。
逐题调用 submitQuestion 提交。

【已学内容】
${corpus || '（无教材语料，仅根据知识点标题出概念题）'}`,
  });

  // 校验—发布：不合格题重生成一次仍败则丢弃
  const published = [];
  for (const q of submitted) {
    let verdict = await verifyQuestion(q, input.unlockedKPIds);
    if (!verdict.ok) {
      verdict = await verifyQuestion(q, input.unlockedKPIds);
    }
    if (!verdict.ok) continue;

    const id = randomUUID();
    db.prepare(
      `INSERT INTO questions (id, course_id, scope, scope_id, type, difficulty, content_json, answer_json, source_kp_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.courseId,
      input.scope,
      input.scopeId,
      q.type,
      input.difficulty,
      JSON.stringify({ stem: q.stem, options: q.options ?? null, testCases: q.testCases ?? null, rubric: q.rubric }),
      JSON.stringify({ answer: q.answer, referenceSolution: q.referenceSolution ?? null }),
      JSON.stringify(q.sourceKPIds),
    );
    published.push({ id, ...q });
  }
  return published;
}
