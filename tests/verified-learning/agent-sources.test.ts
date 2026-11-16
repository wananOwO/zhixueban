import { describe, expect, it } from 'vitest';
import { createSourceTools } from '@/lib/verified-learning/agent/source-tools';
import { assertPublicUrl } from '@/lib/verified-learning/agent/web';
import type { SourceSnapshot } from '@/lib/verified-learning/sources';
import type { RetrieveResult } from '@/lib/verified-learning/retrieval/service';

/** toolResult 把 JSON 放进 content[0].text，测试需拆开这一层 */
function payload(result: unknown): { total: number; degraded?: boolean; matches: { paragraphIndex: number; match: { vector?: boolean } }[] } {
  const content = (result as { content: { text: string }[] }).content;
  return JSON.parse(content[0].text);
}

const source: SourceSnapshot = {
  sourceId: 'b', sourceRevision: 'r', title: '教材', format: 'md',
  chapters: [{ chapterId: 'c', title: '第一章', paragraphs: [
    { paragraphIndex: 9, text: '变量保存数据', contentHash: 'h' },
    { paragraphIndex: 10, text: '循环重复操作', contentHash: 'h2' },
  ]}],
};

describe('Agent教材工具', () => {
  it('返回真实引用与分页，不存在来源作为工具错误', async () => {
    const tools = createSourceTools([source]);
    const read = tools.find(t => t.name === 'read_source')!;
    const result = await read.execute('x', { sourceId: 'b', chapterId: 'c', offset: 0, limit: 1 });
    expect(JSON.stringify(result)).toContain('变量保存数据');
    expect(JSON.stringify(result)).toContain('nextOffset');
    await expect(read.execute('y', { sourceId: 'unknown', chapterId: 'c', offset: 0, limit: 1 })).rejects.toThrow();
    const search = await tools.find(t => t.name === 'search_sources')!.execute('s', { query: '循环' });
    expect(JSON.stringify(search)).toContain('10');
  });

  it('提供检索服务时 search_sources 返回混合检索结果与匹配类型', async () => {
    const calls: string[] = [];
    const retrieval = {
      retrieve: async (query: string): Promise<RetrieveResult> => {
        calls.push(query);
        return {
          degraded: false, keywordCount: 1, vectorCount: 1,
          hits: [{ sourceId: 'b', sourceRevision: 'r', chapterId: 'c', paragraphIndex: 10, text: '循环重复操作', score: 0.5, match: { keyword: true, vector: true, chapterBoost: false }, contentHash: 'h2' }],
        };
      },
    };
    const tools = createSourceTools([source], retrieval);
    const result = await tools.find(t => t.name === 'search_sources')!.execute('s', { query: '循环' });
    const body = payload(result);
    expect(calls).toEqual(['循环']);
    expect(body.matches[0].match.vector).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.matches[0].paragraphIndex).toBe(10);
  });

  it('检索服务出错时退回本地关键词搜索并标记降级', async () => {
    const retrieval = { retrieve: async (): Promise<RetrieveResult> => { throw new Error('provider down'); } };
    const tools = createSourceTools([source], retrieval);
    const result = await tools.find(t => t.name === 'search_sources')!.execute('s', { query: '循环' });
    const body = payload(result);
    expect(body.matches[0].paragraphIndex).toBe(10);
    expect(body.degraded).toBe(true);
  });

  it.each(['http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/', 'http://[::1]/', 'file:///etc/passwd', 'https://user:secret@example.com/'])('只允许公开资料：%s', async url => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });
});