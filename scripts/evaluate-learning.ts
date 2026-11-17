/**
 * 生成、学习证据与工程质量离线评测 CLI：
 *   pnpm eval:learning -- --out data/eval/learning.json
 * 全程只使用内存临时数据库与 CC0 合成语料，不读取或修改生产数据库。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateLearningPipeline,
  formatMetric,
  formatScalar,
  learningReportToMarkdown,
} from '../src/lib/verified-learning/evaluation/metrics';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gitRevision(): string | null {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

async function main() {
  const out = arg('out') ?? 'data/eval/learning.json';
  const report = await evaluateLearningPipeline({ gitRevision: gitRevision() });

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const mdPath = out.replace(/\.json$/, '.md');
  writeFileSync(mdPath, learningReportToMarkdown(report), 'utf8');

  console.log(`课件验收通过率:       ${formatMetric(report.generation.lessonPassRate)}`);
  console.log(`首轮审校通过率:       ${formatMetric(report.generation.questionFirstPassReviewRate)}`);
  console.log(`引用与正文一致率:     ${formatMetric(report.generation.citationConsistencyRate)}`);
  console.log(`重复题拦截率:         ${formatMetric(report.generation.duplicateQuestionInterceptRate)}`);
  console.log(`任务断点恢复成功率:   ${formatMetric(report.generation.jobRecoveryRate)}`);
  console.log(`掌握判定通过率:       ${formatMetric(report.learning.masteryPassRate)}`);
  console.log(`示例课程免 Key 可用率: ${formatMetric(report.engineering.sampleCourseAvailableRate)}`);
  console.log(`任务恢复本地耗时:     ${formatScalar(report.engineering.checkpointRecoveryLatencyMs, 'ms', 2)}`);
  console.log(`\n报告已写入 ${out} 与 ${mdPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
