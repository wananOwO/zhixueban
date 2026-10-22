import type Database from 'better-sqlite3';
import { createAgentLearningModel, type LearningAgentOptions } from './agent/learning-agent';
import { AgentJournal } from './agent/journal';
import type { LibraryService } from './library';

/** 正式生成入口只使用工具驱动Agent，不再解析普通Chat回复作为产物。 */
export function createLearningModel(task?: { db: Database.Database; scope: string; jobId: string; library: LibraryService }, options: LearningAgentOptions = {}) {
  return createAgentLearningModel({
    ...options,
    ...(task ? {
      journal: (stage: string) => new AgentJournal(task.db, task.scope, task.jobId, stage),
      persistSource: (source: Parameters<LibraryService['savePublicSource']>[1]) => task.library.savePublicSource(task.scope, source),
    } : {}),
  });
}
