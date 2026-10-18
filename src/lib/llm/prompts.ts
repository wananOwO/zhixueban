import fs from 'node:fs';
import path from 'node:path';

const SUBJECTS_DIR = path.join(process.cwd(), 'prompts', 'subjects');

/**
 * 加载学科专家提示词（prompts/subjects/<type>.md）。
 * 未知类型回退 general；general 也不存在时返回空字符串。
 */
export function loadSubjectPrompt(subjectType: string): string {
  const candidates = [subjectType, 'general'];
  for (const name of candidates) {
    const file = path.join(SUBJECTS_DIR, `${name}.md`);
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf-8').trim();
    }
  }
  return '';
}
