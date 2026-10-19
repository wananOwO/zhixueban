import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getModel } from '@/lib/llm/provider';
import { runCode } from './executor';

export interface DraftQuestion {
  type: 'choice' | 'fill' | 'code';
  stem: string;
  options?: string[];
  answer: string;
  referenceSolution?: string;
  testCases?: { name: string; assert: string }[];
  rubric: string;
  sourceKPIds: string[];
}

export interface Verdict {
  ok: boolean;
  reason?: string;
}

/**
 * 验题（与出题独立，不给生成上下文）：
 * 1. 结构性检查：code 题必须有参考解与测试用例
 * 2. LLM 独立判定参考解法的实际知识依赖是否 ⊆ 已解锁集合
 * 3. code 题由执行器跑参考解 + 测试用例，跑不通即拒绝
 */
export async function verifyQuestion(
  q: DraftQuestion,
  unlockedKPIds: string[],
  lang: 'javascript' | 'python' = 'javascript',
): Promise<Verdict> {
  if (q.type === 'code') {
    if (!q.referenceSolution || !q.testCases || q.testCases.length === 0) {
      return { ok: false, reason: '编程题必须附参考解与测试用例' };
    }
  }

  let llmVerdict: Verdict = { ok: true };
  const tools = {
    submitVerdict: tool({
      description: '提交题目校验结论',
      inputSchema: z.object({
        ok: z.boolean(),
        reason: z.string().optional(),
        usedKnowledge: z.array(z.string()).describe('参考解法实际使用到的知识'),
      }),
      execute: async (v) => {
        llmVerdict = { ok: v.ok, reason: v.reason };
        return { ok: true };
      },
    }),
  };

  await generateText({
    model: getModel(),
    tools,
    stopWhen: stepCountIs(3),
    prompt: `你是严格的出题校验员。判断这道题的参考解法是否只依赖学习者已学内容。

题目：${q.stem}
参考答案：${q.answer}
${q.referenceSolution ? `参考解法：\n${q.referenceSolution}` : ''}

学习者已解锁的知识点 ID：${unlockedKPIds.join('、')}
题目自报来源知识点：${q.sourceKPIds.join('、')}

注意：自报标签不可信。请分析参考解法**实际**用到的知识，若超出已解锁范围则判定不合格。
调用 submitVerdict 提交结论。`,
  });

  if (!llmVerdict.ok) return llmVerdict;

  if (q.type === 'code') {
    const run = await runCode(lang, q.referenceSolution!, q.testCases!);
    if (!run.ok) {
      return { ok: false, reason: `参考解无法通过测试用例：${run.error ?? '断言失败'}` };
    }
  }
  return { ok: true };
}
