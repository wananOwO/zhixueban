import { describe, expect, it } from 'vitest';
import { attachCitations, citedSentences, parseTutorCitations } from '@/lib/citations';
import type { CitationView } from '@/lib/api/types';

const cite = (paragraphIndex: number, quote: string, sourceId = 'b1'): CitationView => ({ sourceId, sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex, quote });

// 开发库真实课件片段：课件用自己的话转述，引用里是原书原句
const markdown = [
  '## 一、让 Python 跑起来',
  '',
  '### 1. 核心概念',
  '',
  '- 解释器 (interpreter)：读取 Python 代码并逐条执行的程序。运行 `.py` 文件时，解释器会读取整个程序，确定每个单词的含义，比如看到后面跟着括号的 `print`，就把括号里的内容打印到屏幕上。',
  '',
  '## 二、print() 函数：把结果显示到屏幕',
  '',
  '程序算出的结果存在内存里，人看不见。所以需要一个工具，把数据变成文字写到屏幕上。在 Python 里，这个工具就是内置函数 (built-in function) `print()`。',
  '',
  '```',
  "print(*objects, sep=' ', end='\\n', file=None, flush=False)",
  '```',
  '',
  '含义：把 `objects`（你给的若干个值）输出到 `file` 指定的文本流，值与值之间用 `sep` 分隔，末尾加上 `end`。',
].join('\n');

describe('attachCitations：把引用挂到它所支持的正文块上', () => {
  it('按块分割 Markdown，不改动原文', () => {
    const { blocks } = attachCitations(markdown, []);
    expect(blocks.map(b => b.markdown).join('\n\n')).toBe(markdown);
    expect(blocks.filter(b => b.kind === 'heading').map(b => b.markdown)).toEqual(['## 一、让 Python 跑起来', '### 1. 核心概念', '## 二、print() 函数：把结果显示到屏幕']);
    expect(blocks.find(b => b.markdown.startsWith('```'))?.kind).toBe('code');
  });

  it('原句与转述正文用字相近时落到对应块（第 761 段落在解释器那条列表上）', () => {
    const c = cite(761, 'Python 解释器读取整个程序，确定其中每个单词的含义。例如，在看到后面跟着括号的单词 print 时，解释器就会将括号中的内容打印到屏幕上。');
    const { blocks } = attachCitations(markdown, [c]);
    const hit = blocks.find(b => b.citations.length > 0)!;
    expect(hit.markdown).toContain('解释器 (interpreter)');
    expect(hit.citations[0].paragraphIndex).toBe(761);
  });

  it('精确出现在正文里的原句直接定位（代码块里的函数签名）', () => {
    const c = cite(677, "print(*objects, sep=' ', end='\\n', file=None, flush=False)", 'web:aaea');
    const { blocks } = attachCitations(markdown, [c]);
    expect(blocks.find(b => b.citations.length)?.kind).toBe('code');
  });

  it('找不到位置的引用归入所在小节末尾的「本节出处」', () => {
    const c = cite(9999, '完全无关的一句话：今天天气晴朗，适合郊游踏青。');
    const { blocks, sections } = attachCitations(markdown, [c]);
    expect(blocks.every(b => b.citations.length === 0)).toBe(true);
    // 没有可判断的小节时归入最后一节
    expect(sections.at(-1)?.unplaced.map(x => x.paragraphIndex)).toEqual([9999]);
  });

  it('同一块的多个引用按段号排序，同一段不重复', () => {
    const a = cite(678, '将 objects 打印输出至 file 指定的文本流，以 sep 分隔并在末尾加上 end。', 'web:aaea');
    const { blocks } = attachCitations(markdown, [a, { ...a }, cite(677, "print(*objects, sep=' ', end='\\n', file=None, flush=False)", 'web:aaea')]);
    const meaning = blocks.find(b => b.markdown.startsWith('含义'))!;
    expect(meaning.citations.map(x => x.paragraphIndex)).toEqual([678]);
  });

  it('每个块记录所在小节序号（## 二级标题为界）', () => {
    const { blocks } = attachCitations(markdown, []);
    expect(blocks.find(b => b.markdown.startsWith('含义'))?.section).toBe(1);
    expect(blocks.find(b => b.markdown.startsWith('- 解释器'))?.section).toBe(0);
  });

  it('列表项各自成块，引用落到对应的那一项而不是整个列表', () => {
    const md = '## 要点\n\n- 函数调用：函数名加一对圆括号，括号里放参数。\n- 所有要输出的值都会先像 `str()` 那样被转换成字符串。\n  所以数字也能打印。\n- `sep` 必须写成关键字参数。';
    const { blocks } = attachCitations(md, [cite(679, '所有非关键字参数都会被转换为字符串，就像是执行了 str() 一样。')]);
    expect(blocks.filter(b => b.kind === 'text').map(b => b.markdown)).toEqual([
      '- 函数调用：函数名加一对圆括号，括号里放参数。',
      '- 所有要输出的值都会先像 `str()` 那样被转换成字符串。\n  所以数字也能打印。',
      '- `sep` 必须写成关键字参数。',
    ]);
    expect(blocks.find(b => b.citations.length)?.markdown).toContain('str()');
  });

  it('定位不到的引用按提交顺序归入前一个已定位引用所在的小节', () => {
    const md = '## 甲\n\n解释器读取整个程序并逐条执行。\n\n## 乙\n\n变量是指向某个值的名字。\n\n## 丙\n\n总结。';
    const { sections } = attachCitations(md, [cite(1, '变量指向某个值的名字'), cite(2, '完全无关的一句话：今天天气晴朗。')]);
    expect(sections.map(s => s.unplaced.map(c => c.paragraphIndex))).toEqual([[], [2], []]);
  });
});

describe('citedSentences：在块的纯文本里找出被引用的那一句', () => {
  const text = '程序算出的结果存在内存里，人看不见。比赛评测系统也只看你的程序“输出了什么”。在 Python 里，解释器看到后面跟着括号的单词 print 时，会把括号中的内容打印到屏幕上。';
  it('返回最像原句的句子在文本中的起止位置', () => {
    const ranges = citedSentences(text, ['在看到后面跟着括号的单词 print 时，解释器就会将括号中的内容打印到屏幕上。']);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0][0], ranges[0][1])).toBe('在 Python 里，解释器看到后面跟着括号的单词 print 时，会把括号中的内容打印到屏幕上。');
  });
  it('句子边界不含前导空白；多个引用落在同一句时只返回一次', () => {
    const ranges = citedSentences(' 甲乙丙丁。戊己庚辛壬癸。', ['戊己庚辛', '己庚辛壬']);
    expect(ranges).toEqual([[6, 13]]);
  });
  it('没有像的句子时不画线', () => {
    expect(citedSentences(text, ['今天天气晴朗，适合郊游踏青。'])).toEqual([]);
  });
  it('只有一句的块整句画线', () => {
    const one = '变量是指向某个值的名字';
    expect(citedSentences(one, ['每个变量指向一个值'])).toEqual([[0, one.length]]);
  });
});

describe('parseTutorCitations：拆出助教回答里的〔来源ID·第N段〕', () => {
  it('文本与出处交替', () => {
    expect(parseTutorCitations('见〔web:aaea·第678段〕。')).toEqual([
      { type: 'text', text: '见' },
      { type: 'cite', sourceId: 'web:aaea', paragraphIndex: 678 },
      { type: 'text', text: '。' },
    ]);
  });
  it('多处出处、带空格的写法、没有出处的纯文本', () => {
    expect(parseTutorCitations('A〔b1·第 1 段〕B〔b1·第2段〕')).toEqual([
      { type: 'text', text: 'A' },
      { type: 'cite', sourceId: 'b1', paragraphIndex: 1 },
      { type: 'text', text: 'B' },
      { type: 'cite', sourceId: 'b1', paragraphIndex: 2 },
    ]);
    expect(parseTutorCitations('没有出处')).toEqual([{ type: 'text', text: '没有出处' }]);
  });
  it('格式不对的方括号保持原文', () => {
    expect(parseTutorCitations('〔注意〕')).toEqual([{ type: 'text', text: '〔注意〕' }]);
  });
});
