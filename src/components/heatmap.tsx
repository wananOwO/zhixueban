'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const year = new Date().getFullYear();
    chart.setOption({
      tooltip: { formatter: (p: { value: [string, number] }) => `${p.value[0]}：${p.value[1]} 次作答` },
      visualMap: {
        min: 0,
        max: Math.max(5, ...data.map((d) => d.count)),
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#eaeaea', '#0070f3'] },
        textStyle: { color: '#737373' },
      },
      calendar: {
        top: 40,
        range: [`${year}-01-01`, `${year}-12-31`],
        cellSize: ['auto', 14],
        itemStyle: { borderWidth: 2, borderColor: '#fff' },
        splitLine: { show: false },
        dayLabel: { nameMap: ['日', '一', '二', '三', '四', '五', '六'], color: '#737373' },
        monthLabel: { color: '#737373' },
        yearLabel: { show: false },
      },
      series: {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: data.map((d) => [d.date, d.count]),
      },
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [data]);

  return (
    <div>
      <div ref={ref} style={{ height: 220 }} role="img" aria-label="学习活跃度日历热力图" />
      {/* 无障碍：等价的文本列表 */}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary>查看文本版数据</summary>
        <ul>
          {data.map((d) => (
            <li key={d.date}>
              {d.date}：{d.count} 次作答
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
