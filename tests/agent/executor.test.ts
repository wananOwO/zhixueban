import { describe, expect, test } from 'vitest';
import { runCode } from '@/lib/agent/executor';

describe('runCode (javascript 沙箱)', () => {
  test('测试用例全部通过时 ok', async () => {
    const result = await runCode('javascript', 'function add(a,b){return a+b}', [
      { name: '基本加法', assert: 'add(1,2) === 3' },
      { name: '负数', assert: 'add(-1,1) === 0' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  test('断言失败时报告哪个用例挂了', async () => {
    const result = await runCode('javascript', 'function add(a,b){return a-b}', [
      { name: '基本加法', assert: 'add(1,2) === 3' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.results[0].name).toBe('基本加法');
    expect(result.results[0].passed).toBe(false);
  });

  test('死循环被超时中断', { timeout: 15000 }, async () => {
    const result = await runCode('javascript', 'while(true){}', [{ name: 'x', assert: 'true' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/超时|time/i);
  });

  test('沙箱内无法访问 require/process', async () => {
    const result = await runCode('javascript', '', [
      { name: '逃逸尝试', assert: "typeof process === 'undefined' && typeof require === 'undefined'" },
    ]);
    expect(result.ok).toBe(true);
  });

  test('python 未配置 Judge0 时明确报错', async () => {
    delete process.env.JUDGE0_URL;
    const result = await runCode('python', 'print(1)', [{ name: 'x', assert: '1' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Judge0/);
  });
});
