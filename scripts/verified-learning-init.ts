import { initializeVerifiedLearning } from '../src/lib/verified-learning/initialization';
import { LearningError } from '../src/lib/verified-learning/contracts';
import { AppError } from '../src/lib/verified-learning/errors';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let database: string | undefined;
  let create = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--db' && database === undefined && args[index + 1] && !args[index + 1].startsWith('--')) {
      database = args[++index];
    } else if (args[index] === '--create' && !create) {
      create = true;
    } else {
      throw new LearningError('INVALID_INPUT', '用法：pnpm vl:init --db data/app.db [--create]');
    }
  }
  if (!database) throw new LearningError('INVALID_INPUT', '必须显式指定 --db；新建空库另加 --create');
  console.log('仅处理当前项目 data 目录中的指定库；升级前备份保存在数据库同目录。');
  const result = await initializeVerifiedLearning(database, create);
  console.log(`${result.created ? '已新建空库并初始化' : '已检查并完成增量迁移'}，版本 ${result.schemaVersion}。`);
}

void main().catch(error => {
  const message = error instanceof LearningError || error instanceof AppError
    ? error.message : '初始化失败，未宣称迁移完成；请检查文件权限与备份。';
  console.error(message);
  process.exitCode = 1;
});
