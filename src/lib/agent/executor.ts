import vm from 'node:vm';
import { getConfig } from '@/lib/llm/config';

export interface TestCase {
  name: string;
  assert: string;
}

export interface RunResult {
  ok: boolean;
  results: { name: string; passed: boolean; error?: string }[];
  error?: string;
}

const JS_TIMEOUT_MS = 5000;

/** JS 沙箱执行：node:vm，5s 超时，无 require/process */
async function runJavaScript(code: string, testCases: TestCase[]): Promise<RunResult> {
  const sandbox = Object.create(null);
  const context = vm.createContext(sandbox);

  try {
    new vm.Script(code).runInContext(context, { timeout: JS_TIMEOUT_MS });
  } catch (e) {
    return {
      ok: false,
      results: [],
      error: e instanceof Error && /timed out/i.test(e.message) ? '执行超时（5 秒）' : `运行错误：${e}`,
    };
  }

  const results: RunResult['results'] = [];
  for (const tc of testCases) {
    try {
      const passed = new vm.Script(`(${tc.assert})`).runInContext(context, {
        timeout: JS_TIMEOUT_MS,
      });
      results.push({ name: tc.name, passed: passed === true });
    } catch (e) {
      results.push({ name: tc.name, passed: false, error: String(e) });
    }
  }
  return { ok: results.every((r) => r.passed), results };
}

/** Python 走 Judge0（VPS 自部署，JUDGE0_URL 环境变量） */
async function runPython(code: string, testCases: TestCase[]): Promise<RunResult> {
  const base = getConfig('judge0_url', 'JUDGE0_URL');
  if (!base) {
    return {
      ok: false,
      results: [],
      error: '未配置 Judge0 服务（JUDGE0_URL），无法执行 Python 判题',
    };
  }
  const results: RunResult['results'] = [];
  for (const tc of testCases) {
    const source = `${code}\n\nassert (${tc.assert})`;
    const res = await fetch(`${base}/submissions?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language_id: 71, source_code: source }),
    });
    const body = (await res.json()) as { status?: { id: number }; stderr?: string };
    results.push({
      name: tc.name,
      passed: body.status?.id === 3,
      error: body.stderr ?? undefined,
    });
  }
  return { ok: results.every((r) => r.passed), results };
}

/** 代码执行器：判分以测试用例执行结果为准（设计 §5.8） */
export async function runCode(
  lang: 'javascript' | 'python',
  code: string,
  testCases: TestCase[],
): Promise<RunResult> {
  if (lang === 'javascript') return runJavaScript(code, testCases);
  return runPython(code, testCases);
}
