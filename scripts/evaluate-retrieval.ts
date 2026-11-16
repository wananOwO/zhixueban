/**
 * 检索评测 CLI：
 *   pnpm eval:retrieval --fixture tests/fixtures/retrieval/test.json --out data/eval/retrieval.json
 * 默认使用确定性本地向量（只验证链路可复现）；设置 EMBEDDING_* 环境变量时调用真实服务。
 * 结果只写本地忽略目录，不访问生产数据库、不上传语料。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluate, toMarkdown, type Strategy, type EvalReport } from '../src/lib/verified-learning/retrieval/evaluate';
import { createEmbeddingPort } from '../src/lib/verified-learning/retrieval/embedding';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gitRevision(): string | null {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

async function main() {
  const fixtureFile = arg('fixture') ?? 'tests/fixtures/retrieval/test.json';
  const out = arg('out') ?? 'data/eval/retrieval.json';
  const requested = (arg('strategy') ?? 'keyword,vector,hybrid').split(',').filter(Boolean) as Strategy[];
  const strategies = requested.filter(value => ['keyword', 'vector', 'hybrid'].includes(value));
  if (!strategies.length) throw new Error('--strategy 只能是 keyword,vector,hybrid');

  const baseUrl = process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL;
  const apiKey = process.env.EMBEDDING_API_KEY ?? process.env.LLM_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  const useProvider = Boolean(baseUrl && apiKey && model);
  const port = useProvider ? createEmbeddingPort({ baseUrl: baseUrl!, apiKey: apiKey!, model: model! }) : undefined;

  const report: EvalReport = await evaluate({
    fixtureFile,
    strategies,
    embed: port ? port.embed : undefined,
    embeddingLabel: useProvider ? `${model} @ ${baseUrl}` : undefined,
    gitRevision: gitRevision(),
  });

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(out.replace(/\.json$/, '.md'), toMarkdown(report), 'utf8');

  for (const item of report.strategies) {
    console.log(`${item.strategy.padEnd(8)} Recall@3 ${(item.recall3 * 100).toFixed(1)}%  Recall@5 ${(item.recall5 * 100).toFixed(1)}%  MRR ${item.mrr.toFixed(3)}  引用合法率 ${(item.citationValidity * 100).toFixed(1)}%  p95 ${item.latencyP95.toFixed(1)}ms${item.degraded ? '  [降级]' : ''}`);
  }
  console.log(`\n报告已写入 ${out} 与 ${out.replace(/\.json$/, '.md')}`);
  if (!useProvider) console.log('未配置 EMBEDDING_* —— 本次为确定性本地向量，仅验证检索链路，不代表真实语义模型质量。');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });