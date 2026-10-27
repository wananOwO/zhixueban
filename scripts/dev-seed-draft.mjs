// 本地视觉检查用：在当前开发服务里新建一份填好的草稿（只写一次性测试库，不调用模型）。
// 用法：node scripts/dev-seed-draft.mjs  → 打印草稿 ID
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const base = process.env.VL_BASE ?? 'http://127.0.0.1:3101';
const api = `${base}/api/verified-learning/v1`;
const token = readFileSync(path.join(tmpdir(), 'vl-dev-token.txt'), 'utf8').trim();
const headers = { origin: base, 'content-type': 'application/json' };
const login = await fetch(`${api}/access`, { method: 'POST', headers, body: JSON.stringify({ token }) });
if (!login.ok) throw new Error(`登录失败 ${login.status}`);
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = async (method, url, body) => {
  const response = await fetch(api + url, { method, headers: { ...headers, cookie, 'idempotency-key': randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${JSON.stringify(json.error)}`);
  return json.data;
};
const books = await call('GET', '/textbooks');
const book = books.find(b => !b.bookId.startsWith('web:'));
const source = await call('GET', `/textbooks/${book.bookId}/source`);
const draft = await call('POST', '/drafts', {
  title: '蓝桥杯 Python 冲刺',
  goal: '能用 Python 独立写出蓝桥杯省赛入门题：枚举、前缀和、二分查找与简单动态规划',
  textbookId: book.bookId,
  sources: [{ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterIds: source.chapters.map(c => c.chapterId) }],
  teachingPrompt: '每个例子都给出能直接运行的完整代码',
  priorKnowledgeText: '学过一点 C 语言',
  includedTopics: ['输入输出格式'],
  excludedTopics: ['图形界面'],
  templateId: 'builtin:computer', subjectType: 'computer', programmingLanguage: 'python',
});
console.log(draft.draftId);
