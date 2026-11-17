// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotTutorInput } from '@/components/learn/screenshot-tutor-input';
import { VisionExtractionCard } from '@/components/learn/vision-extraction-card';
import { RetrievalEvidence } from '@/components/learn/retrieval-evidence';

const revokedUrls: string[] = [];
beforeEach(() => {
  revokedUrls.length = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:mock-screenshot-url'),
    revokeObjectURL: vi.fn((url: string) => { revokedUrls.push(url); }),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('多模态截图提问组件与出处证据卡片', () => {
  it('选择图片后显示预览与隐私提示，支持键盘删除并释放 Object URL；超限或 SVG 立即报错', () => {
    const onExtract = vi.fn();
    const { unmount } = render(
      <ScreenshotTutorInput
        disabled={false}
        extracting={false}
        error={null}
        onExtract={onExtract}
      />,
    );

    const input = screen.getByLabelText(/选择或粘贴题目与代码截图/i) as HTMLInputElement;
    // SVG 格式前端直接拦截提示
    const svgFile = new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [svgFile] } });
    expect(screen.getByRole('alert').textContent).toMatch(/PNG|JPEG|WebP|SVG/);
    expect(onExtract).not.toHaveBeenCalled();

    // 合法 PNG 显示预览、发送隐私提示，未点击识别前不发送请求
    const pngFile = new File([new Uint8Array([137, 80, 78, 71])], 'code.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [pngFile] } });
    expect(screen.getByText(/截图将发送给所选视觉服务/)).toBeTruthy();
    expect(onExtract).not.toHaveBeenCalled();

    // 点击开始识别触发回调
    fireEvent.click(screen.getByRole('button', { name: /识别截图内容/ }));
    expect(onExtract).toHaveBeenCalledTimes(1);

    // 键盘删除预览并释放 Object URL
    const removeBtn = screen.getByRole('button', { name: /移除截图/ });
    fireEvent.keyDown(removeBtn, { key: 'Delete' });
    expect(revokedUrls).toContain('blob:mock-screenshot-url');
    unmount();
  });

  it('识别结果含不确定项与 needsClarification 时要求用户核对确认，活动进行中禁用变式题入口', () => {
    const onExplain = vi.fn();
    const onPractice = vi.fn();
    render(
      <VisionExtractionCard
        extraction={{
          kind: 'mixed',
          language: 'python',
          transcription: 'def f(n):\n  return f(n-1)',
          concepts: ['递归', '终止条件'],
          code: 'def f(n):\n  return f(n-1)',
          question: '这段代码缺什么？',
          uncertainty: ['第 2 行缩进与减号略模糊'],
          needsClarification: true,
        }}
        allowedPoints={[{ id: 'rec', title: '递归基础' }]}
        hasActiveRun={true}
        busy={false}
        onExplain={onExplain}
        onPractice={onPractice}
        onDiscard={() => {}}
      />,
    );

    expect(screen.getByText(/第 2 行缩进与减号略模糊/)).toBeTruthy();
    const explainBtn = screen.getByRole('button', { name: /确认文字并解释题目/ }) as HTMLButtonElement;
    // 未勾选确认核对或编辑前禁用直接生成结论
    expect(explainBtn.disabled).toBe(true);

    // 进行中活动禁用变式题按钮，防止借变式入口泄题
    const practiceBtn = screen.getByRole('button', { name: /生成 1 道变式题/ }) as HTMLButtonElement;
    expect(practiceBtn.disabled).toBe(true);

    // 用户编辑文字后自动解除阻塞，可点击发送给助教讲解
    const editor = screen.getByLabelText(/识别文字（可编辑核对）/);
    fireEvent.change(editor, { target: { value: 'def f(n):\n    if n <= 1: return 1\n    return f(n - 1)' } });
    expect(explainBtn.disabled).toBe(false);
    fireEvent.click(explainBtn);
    expect(onExplain).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'explain',
      clarified: true,
    }));
  });

  it('RetrievalEvidence 展示来源、章节、段号与关键词/语义/章节加权标签，点击可打开原文抽屉', () => {
    const onOpen = vi.fn();
    render(
      <RetrievalEvidence
        hits={[{
          sourceId: 'b1',
          sourceRevision: 'r1',
          chapterId: 'ch2',
          paragraphIndex: 16,
          text: '递归函数必须具备明确的终止条件。',
          score: 0.0163,
          match: { keyword: true, vector: true, chapterBoost: true },
          contentHash: 'h16',
          sourceTitle: 'Python 教程',
          chapterTitle: '第二章 函数',
          chapterFiltered: true,
        }]}
        degraded={false}
        onOpen={onOpen}
      />,
    );

    // 默认折叠，展开后看到命中详情与匹配方式标签
    fireEvent.click(screen.getByRole('button', { name: /出处详情/ }));
    expect(screen.getByText(/Python 教程/)).toBeTruthy();
    expect(screen.getByText(/第二章 函数/)).toBeTruthy();
    expect(screen.getByText(/关键词命中/)).toBeTruthy();
    expect(screen.getByText(/语义命中/)).toBeTruthy();
    expect(screen.getByText(/已按课程章节过滤/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /第 16 段/ }));
    expect(onOpen).toHaveBeenCalledWith({
      sourceId: 'b1',
      sourceRevision: 'r1',
      chapterId: 'ch2',
      paragraphIndex: 16,
    });
  });
});
