import { z } from 'zod';

export const MAX_TRANSCRIPTION = 8000;
export const MAX_CODE = 20000;
export const MAX_CONCEPTS = 8;

const languageSchema = z.enum(['python', 'javascript', 'c']);
export const visionExtractionSchema = z.strictObject({
  kind: z.enum(['question', 'code', 'mixed', 'unknown']),
  language: languageSchema.nullable().optional(),
  transcription: z.string().min(1).max(MAX_TRANSCRIPTION),
  concepts: z.array(z.string().trim().min(1).max(120)).max(MAX_CONCEPTS),
  code: z.string().max(MAX_CODE).nullable().optional(),
  question: z.string().max(4000).nullable().optional(),
  uncertainty: z.array(z.string().trim().min(1).max(300)).max(8),
  needsClarification: z.boolean(),
});

export type VisionMode = 'explain' | 'analyze-code' | 'practice';
export type VisionExtraction = z.infer<typeof visionExtractionSchema>;

export function visionFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/image|vision|multimodal|unsupported|不支持图片/i.test(text)) {
    return '当前模型不支持图片输入，请在设置中换用支持视觉识别的模型，或直接粘贴文字提问';
  }
  if (/401|403|unauthor|invalid key|api key/i.test(text)) {
    return '视觉模型拒绝了当前 Key，请检查设置后重试';
  }
  if (/timeout|aborted|超时/i.test(text)) {
    return '视觉识别超时，可以手动点击重试一次（可能再次计费），或改用粘贴文字';
  }
  return '视觉识别暂时不可用，可以重试或改用粘贴文字';
}

/**
 * 视觉结果只作为“待用户确认的内容”，不是可信事实，也不是教材来源。
 * 严格 schema：多余字段、未知语言、超长文本都拒绝；概念去重并保持顺序。
 */
export function parseVisionExtraction(input: unknown): VisionExtraction {
  const result = visionExtractionSchema.safeParse(input);
  if (!result.success) throw new Error('识别结果格式不合法，请重试或改用文字粘贴');
  const data = result.data;
  return { ...data, concepts: [...new Set(data.concepts.map(value => value.trim()).filter(Boolean))] };
}

const KIND_LABEL: Record<VisionExtraction['kind'], string> = { question: '题目', code: '代码', mixed: '题目与代码', unknown: '无法确定类型' };

/** 给用户确认用的纯文本摘要；不渲染 HTML，也不展示模型推理过程 */
export function summaryText(extraction: VisionExtraction): string {
  const parts = [KIND_LABEL[extraction.kind]];
  if (extraction.language) parts.push(extraction.language);
  if (extraction.concepts.length) parts.push(`涉及：${extraction.concepts.join('、')}`);
  if (extraction.needsClarification) parts.push('需要确认识别是否准确后再继续');
  if (extraction.uncertainty.length) parts.push(`${extraction.uncertainty.length} 处不确定`);
  return parts.join(' · ');
}