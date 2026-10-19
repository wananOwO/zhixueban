import { createMCPClient } from '@ai-sdk/mcp';
import { getDb } from '@/lib/db';

export interface McpServerConfig {
  name: string;
  url: string;
}

/** 写操作类工具名黑名单（首版仅只读工具，设计 §5.7） */
const WRITE_PATTERNS = /^(write|delete|remove|create|update|execute|run|command|shell|exec|set|put|patch|post)/i;

export interface McpToolsResult {
  tools: Record<string, unknown>;
  failures: string[];
  clients: { close: () => Promise<void> }[];
}

/**
 * 从 settings 表读 MCP server 配置并连接。
 * 不可达的 server 跳过并记录，不阻塞其余（Review Focus 降级原则）。
 */
export async function getMcpTools(): Promise<McpToolsResult> {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'mcp_servers'").get() as
    | { value: string }
    | undefined;
  const servers: McpServerConfig[] = row ? JSON.parse(row.value) : [];

  const tools: Record<string, unknown> = {};
  const failures: string[] = [];
  const clients: { close: () => Promise<void> }[] = [];

  for (const server of servers) {
    try {
      const client = await createMCPClient({
        name: server.name,
        transport: { type: 'http', url: server.url },
      });
      const serverTools = await client.tools();
      for (const [toolName, toolDef] of Object.entries(serverTools)) {
        if (WRITE_PATTERNS.test(toolName)) continue; // 过滤写操作
        tools[`${server.name}_${toolName}`] = toolDef;
      }
      clients.push(client);
    } catch {
      failures.push(`${server.name}（${server.url}）连接失败`);
    }
  }
  return { tools, failures, clients };
}
