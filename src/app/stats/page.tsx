import { getDb } from '@/lib/db';
import { dailyActivity, graphData } from '@/lib/stats';
import Heatmap from '@/components/heatmap';
import KnowledgeGraphView from '@/components/knowledge-graph-view';

export const dynamic = 'force-dynamic';

export default function StatsPage() {
  const db = getDb();
  const activity = dailyActivity();
  const textbook = db
    .prepare('SELECT id, title FROM textbooks ORDER BY created_at DESC LIMIT 1')
    .get() as { id: string; title: string } | undefined;
  const graph = textbook ? graphData(textbook.id) : { nodes: [], edges: [] };
  const mastered = graph.nodes.filter((n) => n.tier === 'green').length;

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-8 text-2xl font-bold">学习画像</h1>

      <section aria-labelledby="progress-h" className="mb-10">
        <h2 id="progress-h" className="mb-3 text-lg font-semibold">总体进度</h2>
        {graph.nodes.length > 0 ? (
          <>
            <div
              role="progressbar"
              aria-valuenow={Math.round((mastered / graph.nodes.length) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-success transition-all"
                style={{ width: `${(mastered / graph.nodes.length) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              已掌握 {mastered} / {graph.nodes.length} 个知识点
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">还没有学习数据，先去创建一门课程。</p>
        )}
      </section>

      <section aria-labelledby="heatmap-h" className="mb-10">
        <h2 id="heatmap-h" className="mb-3 text-lg font-semibold">学习热力图</h2>
        <Heatmap data={activity} />
      </section>

      <section aria-labelledby="graph-h">
        <h2 id="graph-h" className="mb-3 text-lg font-semibold">
          知识图谱{textbook ? ` · 《${textbook.title}》` : ''}
        </h2>
        {graph.nodes.length > 0 ? (
          <KnowledgeGraphView nodes={graph.nodes} edges={graph.edges} />
        ) : (
          <p className="text-sm text-muted-foreground">暂无知识图谱。</p>
        )}
      </section>
    </main>
  );
}
