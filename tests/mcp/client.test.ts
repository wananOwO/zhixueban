import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockCreateMCPClient = vi.fn();
vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: (...args: unknown[]) => mockCreateMCPClient(...args),
}));

import { getMcpTools } from '@/lib/mcp/client';
import { getDb, resetDbForTest } from '@/lib/db';

describe('getMcpTools', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    mockCreateMCPClient.mockReset();
  });

  test('未配置任何 server 时返回空工具集', async () => {
    const { tools, failures } = await getMcpTools();
    expect(tools).toEqual({});
    expect(failures).toEqual([]);
  });

  test('可达 server 的工具并入集合；不可达的跳过并记录', async () => {
    const db = getDb(':memory:');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'mcp_servers',
      JSON.stringify([
        { name: 'good', url: 'http://localhost:1/mcp' },
        { name: 'bad', url: 'http://localhost:2/mcp' },
      ]),
    );

    mockCreateMCPClient.mockImplementation(async ({ name }: { name: string }) => {
      if (name === 'bad') throw new Error('连接失败');
      return {
        tools: async () => ({ search: { description: '搜索' } }),
        close: async () => {},
      };
    });

    const { tools, failures } = await getMcpTools();
    expect(Object.keys(tools)).toContain('good_search');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('bad');
  });

  test('写操作类工具被过滤（首版仅只读）', async () => {
    const db = getDb(':memory:');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'mcp_servers',
      JSON.stringify([{ name: 'srv', url: 'http://localhost:1/mcp' }]),
    );
    mockCreateMCPClient.mockResolvedValueOnce({
      tools: async () => ({
        searchDocs: { description: '查询文档' },
        deleteFile: { description: '删除文件' },
        writeConfig: { description: '写入配置' },
        executeCommand: { description: '执行命令' },
      }),
      close: async () => {},
    });

    const { tools } = await getMcpTools();
    expect(Object.keys(tools)).toEqual(['srv_searchDocs']);
  });
});
