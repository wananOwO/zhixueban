import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { getDb } from '@/lib/db';
import { getModel } from '@/lib/llm/provider';
import { runCode } from './executor';
import { updateMastery } from './mastery';

export interface JudgeResult {
  correct: boolean;
  score: number;
  feedback: string;
}

interface QuestionRow {
  id: string;
  type: 'choice' | 'fill' | 'code';
  content_json: string;
  answer_json: string;
  source_kp_ids: string;
}

/**
 * 判题：客观题本地比对；编程题以执行器测试用例结果为准，LLM 只负责解释；
 * 主观题用 rubric + LLM 评价。判分写入 attempts 并回写掌握度。
 */
export async function judgeAnswer(questionId: string, userAnswer: string): Promise<JudgeResult> {
  const db = getDb();
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId) as
    | QuestionRow
    | undefined;
  if (!q) throw new Error('题目不存在');

  const content = JSON.parse(q.content_json);
  const answer = JSON.parse(q.answer_json);
  let result: JudgeResult;

  if (q.type === 'choice' || q.type === 'fill') {
    const correct = userAnswer.trim() === String(answer.answer).trim();
    result = { correct, score: correct ? 1 : 0, feedback: correct ? '回答正确' : `正确答案：${answer.answer}` };
  } else {
    const run = await runCode('javascript', userAnswer, content.testCases ?? []);
    if (run.ok) {
      result = { correct: true, score: 1, feedback: '全部测试用例通过' };
    } else {
      // LLM 仅解释错误，不做对错判断
      const failed = run.results.filter((r) => !r.passed).map((r) => r.name).join('、');
      const { text } = await generateText({
        model: getModel(),
        prompt: `学生的代码未通过测试用例（失败用例：${failed}${run.error ? `，错误：${run.error}` : ''}）。
题目：${content.stem}
学生代码：
${userAnswer}
请用两句话指出最可能的原因，不要给出完整答案。`,
      });
      result = { correct: false, score: 0, feedback: text };
    }
  }

  db.prepare('INSERT INTO attempts (id, question_id, user_answer, correct, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    questionId,
    userAnswer,
    result.correct ? 1 : 0,
    new Date().toISOString(),
  );

  const kpIds = JSON.parse(q.source_kp_ids) as string[];
  const kpExists = db.prepare('SELECT 1 FROM knowledge_points WHERE id = ?');
  for (const kpId of kpIds) {
    if (kpExists.get(kpId)) updateMastery(kpId, result.correct);
  }

  return result;
}

const HINT_LEVELS: Record<number, string> = {
  1: '只提示相关概念名称，不解释怎么做',
  2: '提示解题思路方向，不给步骤',
  3: '给出局部步骤提示，但保留关键一步让学生自己完成',
  4: '给出完整解析与答案，并解释原理',
};

/** 分层提示：概念 → 思路 → 步骤 → 完整解析 */
export async function getHint(questionId: string, level: 1 | 2 | 3 | 4): Promise<string> {
  const db = getDb();
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId) as
    | QuestionRow
    | undefined;
  if (!q) throw new Error('题目不存在');
  const content = JSON.parse(q.content_json);
  const answer = JSON.parse(q.answer_json);

  const { text } = await generateText({
    model: getModel(),
    prompt: `学生在题目「${content.stem}」上需要第 ${level} 级提示。
要求：${HINT_LEVELS[level]}。
${level === 4 ? `参考答案：${answer.answer}` : '不要泄露完整答案。'}`,
  });
  return text;
}
