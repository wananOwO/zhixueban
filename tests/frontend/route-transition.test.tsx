// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteTransition } from '@/components/shell/route-transition';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
let reduced = false;
let animate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  route.pathname = '/';
  reduced = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

function StatefulChild() {
  const [value] = useState(() => Math.random().toString());
  return <input aria-label="答案" defaultValue={value} />;
}

describe('内容区轻量切换', () => {
  it('切换时只对内容执行 160ms 动画，不重建子组件', () => {
    let mounts = 0;
    function Child() { useEffect(() => { mounts++; }, []); return <StatefulChild />; }
    const { rerender } = render(<RouteTransition><Child /></RouteTransition>);
    const input = screen.getByRole('textbox');
    route.pathname = '/library';
    rerender(<RouteTransition><Child /></RouteTransition>);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(mounts).toBe(1);
    expect(animate).toHaveBeenLastCalledWith([
      { opacity: 0.94, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  });

  it('快速连续导航取消上一个动画，卸载时清理', () => {
    const { rerender, unmount } = render(<RouteTransition>内容</RouteTransition>);
    const first = animate.mock.results.at(-1)!.value;
    route.pathname = '/courses';
    rerender(<RouteTransition>课程</RouteTransition>);
    expect(first.cancel).toHaveBeenCalledOnce();
    const second = animate.mock.results.at(-1)!.value;
    unmount();
    expect(second.cancel).toHaveBeenCalledOnce();
  });

  it('同一路径数据更新不重复动画', () => {
    const { rerender } = render(<RouteTransition>加载中</RouteTransition>);
    const count = animate.mock.calls.length;
    rerender(<RouteTransition>已加载</RouteTransition>);
    expect(animate).toHaveBeenCalledTimes(count);
  });

  it('减少动态效果时内容直接可见，不启动动画', () => {
    reduced = true;
    render(<RouteTransition>课程内容</RouteTransition>);
    expect(screen.getByText('课程内容')).toBeTruthy();
    expect(animate).not.toHaveBeenCalled();
  });

  it('不支持 Web Animations 的浏览器仍正常显示内容', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    render(<RouteTransition>课程内容</RouteTransition>);
    expect(screen.getByText('课程内容')).toBeTruthy();
  });
});
