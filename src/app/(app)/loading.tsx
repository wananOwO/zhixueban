import { BlockLoading } from '@/components/states/block-states';

/** 未命中完整预取时保留顶栏，只显示安静的内容占位。 */
export default function Loading() {
  return (
    <div className="pt-6">
      <div aria-hidden className="mb-6 h-8 w-40 rounded-sm bg-raised" />
      <div className="min-h-64 rounded-[var(--radius-paper)] bg-paper px-7 py-6 max-md:px-4">
        <BlockLoading lines={6} label="正在切换页面" />
      </div>
    </div>
  );
}
