import type Database from 'better-sqlite3';
import { createAgentLearningModel, type LearningAgentOptions } from './agent/learning-agent';
import { AgentJournal } from './agent/journal';
import { createAgentConnection } from './agent/provider';
import type { LibraryService } from './library';
import type { ModelConfig } from './model-keys';

/**
 * 正式生成入口只使用工具驱动Agent，不再解析普通Chat回复作为产物。
 * config：线上模式由浏览器传来、只存在内存中的模型配置；本地模式省略即读设置。
 * 连接在首次调用模型时才建立：缺少 Key 时由任务以可恢复失败的形式报告。
 */
export function createLearningModel(task?: { db: Database.Database; scope: string; jobId: string; library: LibraryService; config?: ModelConfig }, options: LearningAgentOptions = {}) {
  const lazy = options.connection ?? {
    get model() { return createAgentConnection(task?.config).model; },
    get streamFn() { return createAgentConnection(task?.config).streamFn; },
  };
  return createAgentLearningModel({
    ...options,
    connection: options.connection ?? (task?.config ? createAgentConnection(task.config) : lazy),
    ...(task ? {
      journal: (stage: string) => new AgentJournal(task.db, task.scope, task.jobId, stage),
      persistSource: (source: Parameters<LibraryService['savePublicSource']>[1]) => task.library.savePublicSource(task.scope, source),
    } : {}),
  });
}
