// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GradeMark } from '@/components/zhupi/grade-mark';
import { Roadmap } from '@/components/zhupi/roadmap';
import { Tape } from '@/components/zhupi/tape';
import { CitationNote } from '@/components/zhupi/citation-note';
import { coursePoints } from './fixtures';

beforeAll(() => {
  // jsdom 没有 ResizeObserver 与 matchMedia
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => cleanup());

describe('批改标记', () => {
  it('四种标记各有可读名称', () => {
    render(<div><GradeMark kind="ok" /><GradeMark kind="no" /><GradeMark kind="void" /><GradeMark kind="pending" /></div>);
    for (const label of ['答对', '答错', '答错，不计入', '待作答']) expect(screen.getByRole('img', { name: label })).toBeTruthy();
  });
});

describe('先修路线图', () => {
  it('每个知识点是一个按钮，名称包含角色与证据数', () => {
    render(<Roadmap points={coursePoints} evidence={{ 'py-hello-print': ['no', 'ok'] }} current="py-hello-print" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(18);
    expect(screen.getByRole('button', { name: /运行第一个 Python 程序与 print\(\) 输出，先修，计入证据 2 题，正在学习/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /枚举 Enumeration，学习目标，计入证据 0 题/ })).toBeTruthy();
  });

  it('聚焦某个知识点时，它的整条先修链被标记', () => {
    render(<Roadmap points={coursePoints} evidence={{}} />);
    const bfs = screen.getByRole('button', { name: /广度优先搜索 BFS/ });
    fireEvent.focus(bfs);
    const lit = screen.getAllByRole('button').filter(b => b.dataset.lit === 'true').map(b => b.dataset.id);
    expect(lit).toContain('algo-bfs');
    expect(lit).toContain('py-hello-print');
    expect(lit).not.toContain('algo-greedy');
    fireEvent.blur(bfs);
    expect(screen.getAllByRole('button').some(b => b.dataset.lit === 'true')).toBe(false);
  });

  it('点击知识点回调其 id', () => {
    const onOpen = vi.fn();
    render(<Roadmap points={coursePoints} evidence={{}} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /二分查找/ }));
    expect(onOpen).toHaveBeenCalledWith('algo-binary-search');
  });

  it('窄屏渲染为按层分组的列表', () => {
    render(<Roadmap points={coursePoints} evidence={{}} compact />);
    expect(screen.getByRole('list', { name: /按先修层级排列/ })).toBeTruthy();
    expect(screen.getByText('第 7 层')).toBeTruthy();
  });
});

describe('书带与出处旁注', () => {
  it('书带说明读取段数与引用处数', () => {
    render(<Tape total={4049} reads={[[680, 699], [690, 710]]} cites={[680, 761, 761]} label="Python编程" />);
    expect(screen.getByRole('img', { name: 'Python编程：共 4,049 段，Agent 读过 31 段，课件引用 2 处' })).toBeTruthy();
  });

  it('旁注显示来源与段号，点击回调', () => {
    const onOpen = vi.fn();
    render(<CitationNote sourceLabel="教材" paragraphIndex={761} quote="在看到后面跟着括号的单词 print 时" onOpen={onOpen} />);
    const note = screen.getByRole('button', { name: /教材 · 第 761 段/ });
    fireEvent.click(note);
    expect(onOpen).toHaveBeenCalled();
  });
});
