// 前端依赖的 API 冒烟检查：登录、教材、草稿、模板、任务、旧课、画像。
// 仅针对本地一次性测试库运行，不触发生成（生成需要真实模型配置）。
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3101/api/verified-learning/v1';
// 口令由启动脚本生成并写入临时文件，避免硬编码
const TOKEN = readFileSync(`${process.env.TEMP}/vl-smoke-token.txt`, 'utf8').trim();
let cookie = '';
let failures = 0;

function check(name, condition, extra = '') {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

async function call(path, { method = 'GET', body, key, form, raw = false } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      // 浏览器同源请求会自动带 Origin；脚本需显式模拟
      origin: 'http://127.0.0.1:3101',
      ...(form ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 导出等非 JSON */
  }
  return { status: res.status, json, text, raw };
}

// 未登录
let r = await call('/textbooks');
check('未登录访问返回401', r.status === 401 && r.json?.error, `got ${r.status}`);

// 错误口令
r = await call('/access', { method: 'POST', body: { token: 'wrong' } });
check('错误口令返回401', r.status === 401, `got ${r.status}`);

// 正确口令
r = await call('/access', { method: 'POST', body: { token: TOKEN } });
check('正确口令登录成功', r.status === 200 && r.json?.data?.expiresAt, `got ${r.status}`);
check('登录设置cookie', cookie.length > 0);

r = await call('/access');
check('GET /access 已认证', r.status === 200 && r.json?.data?.authenticated === true);

// 教材库
r = await call('/textbooks');
check('教材列表为空数组', r.status === 200 && Array.isArray(r.json?.data));

const md = '# 第一章 排序\n\n冒泡排序是稳定的排序算法。\n\n# 第二章 查找\n\n二分查找要求有序。';
const form = new FormData();
form.append('file', new File([md], 'smoke.md', { type: 'text/markdown' }));
r = await call('/textbooks', { method: 'POST', form, key: crypto.randomUUID() });
check('上传教材返回201', r.status === 201 && r.json?.data?.bookId, `got ${r.status} ${r.text.slice(0, 200)}`);
const book = r.json?.data;
check('BookView包含章节', Array.isArray(book?.chapters) && book.chapters.length === 2);

// 同键重试不产生重复
r = await call('/textbooks');
check('上传后列表为1', r.json?.data?.length === 1, `got ${r.json?.data?.length}`);

const bookId = book.bookId;
r = await call(`/textbooks/${bookId}`);
check('教材详情', r.status === 200 && r.json?.data?.sourceRevision);

r = await call(`/textbooks/${bookId}/source`);
const snapshot = r.json?.data;
check('来源快照含段落', snapshot?.chapters?.[0]?.paragraphs?.length > 0);

const chapterId = snapshot.chapters[0].chapterId;
r = await call(`/textbooks/${bookId}/chapters/${chapterId}?offset=0`);
check('章节分页', r.status === 200 && Array.isArray(r.json?.data?.paragraphs), `got ${r.status}`);

r = await call(`/textbooks/${bookId}/deletion`);
check('删除影响预览', r.status === 200 && r.json?.data?.blocked === false);

// 归档/恢复
r = await call(`/textbooks/${bookId}`, {
  method: 'PATCH',
  body: { expectedRevision: book.revision, archived: true },
});
check('归档教材', r.status === 200 && r.json?.data?.archived === true, r.text.slice(0, 200));
r = await call(`/textbooks/${bookId}`, {
  method: 'PATCH',
  body: { expectedRevision: r.json.data.revision, archived: false },
});
check('恢复教材', r.status === 200 && r.json?.data?.archived === false);

// 草稿
r = await call('/drafts', { method: 'POST', body: {}, key: crypto.randomUUID() });
check('创建空草稿', r.status === 201 && r.json?.data?.state === 'editing', `got ${r.status} ${r.text.slice(0, 200)}`);
const draft = r.json?.data;

r = await call(`/drafts/${draft.draftId}`, {
  method: 'PATCH',
  body: {
    expectedRevision: draft.revision,
    input: { goal: '学会排序', sources: [{ sourceId: bookId, sourceRevision: snapshot.sourceRevision, chapterIds: [chapterId] }] },
  },
  key: crypto.randomUUID(),
});
check('草稿自动保存', r.status === 200 && r.json?.data?.input?.goal === '学会排序', r.text.slice(0, 300));
const savedDraft = r.json?.data;

// 409 冲突
r = await call(`/drafts/${draft.draftId}`, {
  method: 'PATCH',
  body: { expectedRevision: draft.revision, input: { goal: '过期修订' } },
  key: crypto.randomUUID(),
});
check('过期修订号返回409', r.status === 409, `got ${r.status}`);

// 模板
r = await call('/templates');
check('模板列表', r.status === 200 && Array.isArray(r.json?.data?.builtins));

// 任务
r = await call('/jobs');
check('任务列表', r.status === 200 && Array.isArray(r.json?.data));

// 课程/旧课
r = await call('/courses');
check('课程列表', r.status === 200 && Array.isArray(r.json?.data));
r = await call('/legacy/courses');
check('已删除旧课程接口', r.status === 404);
r = await call('/textbooks/legacy');
check('已删除旧教材接口', r.status === 404);

// 判题配置：未配置 Judge0 时应返回 502 JUDGE_UNAVAILABLE（前端据此显示未就绪）
r = await call('/judge');
check(
  '判题能力查询（未配置时502）',
  (r.status === 200 && r.json?.data !== undefined) ||
    (r.status === 502 && r.json?.error?.code === 'JUDGE_UNAVAILABLE'),
  `got ${r.status}`,
);

// 画像（不存在版本应报错而非崩溃）
r = await call('/progress?versionId=nope');
check('不存在版本画像返回错误', r.status >= 400 && r.json?.error);

// 登出
r = await call('/access', { method: 'DELETE' });
check('登出', r.status === 200);
r = await call('/textbooks');
check('登出后401', r.status === 401);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
