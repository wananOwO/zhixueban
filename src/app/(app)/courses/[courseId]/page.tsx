'use client';

// 临时视觉检查页（任务 11 替换为正式课程主页）：用真实课程结构渲染朱批组件
import { Roadmap } from '@/components/zhupi/roadmap';
import { Tape } from '@/components/zhupi/tape';
import { CitationNote } from '@/components/zhupi/citation-note';
import { GradeMark } from '@/components/zhupi/grade-mark';
import { PageHeader } from '@/components/shell/page-header';

const P = [
  ['py-hello-print', '运行程序与 print()', 'prerequisite', []],
  ['py-variables-numbers', '变量与数值运算', 'prerequisite', ['py-hello-print']],
  ['py-input-int', 'input() 与 int()', 'target', ['py-variables-numbers']],
  ['py-if-conditions', 'if-elif-else 分支', 'prerequisite', ['py-variables-numbers']],
  ['py-list', '列表 list', 'prerequisite', ['py-variables-numbers']],
  ['py-for-range', 'for 与 range()', 'prerequisite', ['py-list']],
  ['py-while-break', 'while 与 break', 'prerequisite', ['py-if-conditions']],
  ['py-sort', 'sort() 与 sorted()', 'prerequisite', ['py-list']],
  ['py-dict', '字典 dict', 'target', ['py-list']],
  ['py-function', '函数 def 与 return', 'prerequisite', ['py-if-conditions', 'py-list']],
  ['algo-complexity', '时间复杂度', 'prerequisite', ['py-for-range']],
  ['algo-enumerate', '枚举', 'target', ['py-for-range', 'py-if-conditions', 'algo-complexity']],
  ['algo-prefix-sum', '一维前缀和', 'target', ['py-for-range', 'algo-complexity']],
  ['algo-binary-search', '二分查找', 'target', ['py-while-break', 'py-sort', 'algo-complexity']],
  ['algo-recursion', '递归', 'prerequisite', ['py-function']],
  ['algo-greedy', '贪心算法', 'target', ['py-sort', 'algo-enumerate']],
  ['algo-dp-basic', '动态规划基础', 'target', ['algo-recursion', 'py-list']],
  ['algo-bfs', '广度优先搜索', 'target', ['py-while-break', 'py-list', 'py-dict', 'py-function']],
] as const;
const points = P.map(([id, title, role, pre]) => ({ id, title, role, prerequisiteIds: [...pre] }));

export default function Page() {
  return (
    <>
      <PageHeader crumbs={[{ href: '/courses', label: '我的课程' }, { label: '组件检查' }]} title="组件检查" />
      <section className="mt-6 rounded-[var(--radius-paper)] bg-paper px-7 py-6">
        <h2 className="font-serif text-h3 font-bold">先修路线图</h2>
        <Roadmap className="mt-4" points={points} evidence={{ 'py-hello-print': ['no', 'ok'] }} current="py-hello-print" />
      </section>
      <section className="mt-6 grid grid-cols-3 gap-6 max-md:grid-cols-1">
        <div className="rounded-[var(--radius-paper)] bg-paper px-7 py-6">
          <h2 className="font-serif text-h3 font-bold">书带</h2>
          <Tape className="mt-3" total={4049} label="Python编程" reads={[[18, 37], [680, 699], [728, 747], [748, 767], [787, 793]]} cites={[680, 690, 696, 730, 734, 744, 748, 761, 791, 813]} />
        </div>
        <div className="rounded-[var(--radius-paper)] bg-paper px-7 py-6">
          <h2 className="font-serif text-h3 font-bold">旁注</h2>
          <CitationNote className="mt-3" sourceLabel="教材" paragraphIndex={761} quote="在看到后面跟着括号的单词 print 时，解释器就会将括号中的内容打印到屏幕上。" />
        </div>
        <div className="rounded-[var(--radius-paper)] bg-paper px-7 py-6">
          <h2 className="font-serif text-h3 font-bold">批改</h2>
          <div className="mt-3 flex items-center gap-3"><GradeMark kind="ok" size="lg" animate /><GradeMark kind="no" size="lg" animate /><GradeMark kind="void" size="lg" /><GradeMark kind="pending" size="lg" /></div>
        </div>
      </section>
    </>
  );
}
