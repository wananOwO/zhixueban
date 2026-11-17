import { describe, expect, it } from 'vitest';
import { parseVisionExtraction, summaryText, MAX_TRANSCRIPTION } from '@/lib/verified-learning/vision/extraction';

const valid = {
  kind: 'code', language: 'python', transcription: 'def f(n):\n    return n * f(n - 1)',
  concepts: ['递归', '终止条件'], code: 'def f(n):\n    return n * f(n - 1)', uncertainty: [], needsClarification: false,
};

describe('结构化视觉结果', () => {
  it('接受合法结果并去重概念', () => {
    const parsed = parseVisionExtraction({ ...valid, concepts: ['递归', '递归', ' 终止条件 '] });
    expect(parsed.concepts).toEqual(['递归', '终止条件']);
    expect(parsed.language).toBe('python');
  });

  it('拒绝超长转录、超量概念与未知语言', () => {
    expect(() => parseVisionExtraction({ ...valid, transcription: 'x'.repeat(MAX_TRANSCRIPTION + 1) })).toThrow(/过短|过长|格式/);
    expect(() => parseVisionExtraction({ ...valid, concepts: Array.from({ length: 20 }, (_, i) => `c${i}`) })).toThrow(/格式/);
    expect(() => parseVisionExtraction({ ...valid, language: 'rust' })).toThrow(/格式/);
  });

  it('拒绝把识别内容当作可信事实：缺字段或类型不符都失败', () => {
    expect(() => parseVisionExtraction({ ...valid, kind: 'unknown-nope' })).toThrow(/格式/);
    expect(() => parseVisionExtraction({ transcription: '只有文字' })).toThrow(/格式/);
    expect(() => parseVisionExtraction(null)).toThrow(/格式/);
  });

  it('不确定项会保留并在需要澄清时标记', () => {
    const parsed = parseVisionExtraction({ ...valid, uncertainty: ['第 3 行有个符号看不清'], needsClarification: true });
    expect(parsed.uncertainty).toEqual(['第 3 行有个符号看不清']);
    expect(parsed.needsClarification).toBe(true);
    expect(summaryText(parsed)).toContain('需要确认');
  });

  it('摘要文本包含类型、语言与概念，供用户确认', () => {
    const text = summaryText(parseVisionExtraction(valid));
    expect(text).toContain('代码');
    expect(text).toContain('python');
    expect(text).toContain('递归');
  });

  it('不含可执行 HTML：Markdown/HTML 标签按普通文本保留', () => {
    const parsed = parseVisionExtraction({ ...valid, transcription: '<script>alert(1)</script>' });
    expect(parsed.transcription).toContain('<script>');
    expect(summaryText(parsed)).not.toContain('<script>alert');
  });
});