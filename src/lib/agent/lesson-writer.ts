import { embed, streamText } from 'ai';
import { getDb } from '@/lib/db';
import { getEmbeddingModel, getModel } from '@/lib/llm/provider';
import { loadSubjectPrompt } from '@/lib/llm/prompts';
import { searchChunks } from '@/lib/rag/store';

export interface SourceRef {
  chapterId: string;
  index: number;
}

const SRC_RE = /\[src:([A-Za-z0-9_-]+):(\d+)\]/g;

/** 从课件文本中提取 [src:chapterId:index] 来源标记 */
export function parseSourceRefs(text: string): SourceRef[] {
  return [...text.matchAll(SRC_RE)].map((m) => ({ chapterId: m[1], index: Number(m[2]) }));
}

export interface LessonPromptInput {
  kpTitle: string;
  subjectPrompt: string;
  goalPrompt: string;
  anchors: { content: string; chapterId: string; index: number }[];
}

/** 组装课件生成提示词：学科风格 + 学习约定 + 教材锚点（RAG 防幻觉但不锁死） */
export function buildLessonPrompt(input: LessonPromptInput): string {
  const anchorBlock =
    input.anchors.length > 0
      ? input.anchors
          .map((a) => `<source ref="[src:${a.chapterId}:${a.index}]">\n${a.content}\n</source>`)
          .join('\n')
      : '（教材中未检索到直接相关内容，可依据通用知识讲解，但不得虚构教材引用标记）';

  return `${input.subjectPrompt}

你正在为学习者讲解知识点「${input.kpTitle}」。
${input.goalPrompt ? `学习者背景与教学要求：${input.goalPrompt}` : ''}

【教材相关内容】（以教材为中心，但不限于此——你可以补充类比、示例与最新实践）
${anchorBlock}

要求：
1. 引用教材内容时，句末标注对应的 [src:章节ID:序号] 标记；自己补充的内容不标注
2. 输出 Markdown：可用标题、列表、代码块（注明语言）、LaTeX 公式（$...$/$$...$$）、图片占位
3. 由浅入深，一次只引入少量新概念，结尾小结要点
4. 不要输出可执行组件代码，只输出内容与格式`;
}

export interface StreamLessonInput {
  courseId: string;
  kpId: string;
  kpTitle: string;
  textbookId: string;
  subjectType: string;
  goalPrompt: string;
}

/** 流式生成课件：RAG 检索教材锚点 → streamText */
export async function streamLesson(input: StreamLessonInput) {
  const db = getDb();
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: input.kpTitle,
  });
  const chunks = searchChunks(db, input.textbookId, embedding, 5);

  const prompt = buildLessonPrompt({
    kpTitle: input.kpTitle,
    subjectPrompt: loadSubjectPrompt(input.subjectType),
    goalPrompt: input.goalPrompt,
    anchors: chunks.map((c) => ({
      content: c.content,
      chapterId: c.anchor.chapterId,
      index: c.anchor.index,
    })),
  });

  return streamText({ model: getModel(), prompt });
}
