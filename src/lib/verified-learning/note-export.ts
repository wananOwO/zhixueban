/**
 * 笔记导出为 Obsidian 可读的 Markdown：YAML frontmatter（课程、知识点、导出时间、来源）+ 正文。
 * frontmatter 的值一律写成 JSON 字符串（YAML 兼容），引号与换行被转义，不能注入额外字段。
 */
export function renderNoteMarkdown(note: { course: string; point: string; content: string; exportedAt: string }): string {
  return [
    '---',
    `course: ${JSON.stringify(note.course)}`,
    `knowledge_point: ${JSON.stringify(note.point)}`,
    `exported_at: ${note.exportedAt}`,
    'source: 智学伴',
    '---',
    '',
    note.content,
    '',
  ].join('\n');
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** 用标题生成单段文件名：去掉路径分隔符与 Windows 非法字符，限长，避开设备保留名 */
export function noteSegment(title: string, fallback: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 文件名里的控制字符必须去掉
  let name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '');
  if (!name) name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  return name.slice(0, 120);
}

export function noteFileName(title: string): string {
  return `${noteSegment(title, '笔记')}.md`;
}
