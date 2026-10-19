/** TipTap JSON 文档 → Markdown。支持 StarterKit 常见节点。 */

interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: TiptapNode[];
}

function inline(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      let text = n.text ?? inline(n.content);
      if (n.marks) {
        for (const m of n.marks) {
          if (m.type === 'bold') text = `**${text}**`;
          else if (m.type === 'italic') text = `*${text}*`;
          else if (m.type === 'code') text = `\`${text}\``;
        }
      }
      return text;
    })
    .join('');
}

function block(node: TiptapNode): string {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(node.content)}`;
    case 'paragraph':
      return inline(node.content);
    case 'codeBlock':
      return '```\n' + (node.content?.map((c) => c.text ?? '').join('') ?? '') + '\n```';
    case 'blockquote':
      return (node.content ?? []).map(block).join('\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'bulletList':
      return (node.content ?? []).map((li) => `- ${inline(li.content?.[0]?.content)}`).join('\n');
    case 'orderedList':
      return (node.content ?? []).map((li, i) => `${i + 1}. ${inline(li.content?.[0]?.content)}`).join('\n');
    case 'horizontalRule':
      return '---';
    default:
      return inline(node.content);
  }
}

export function tiptapJsonToMarkdown(doc: { type: string; content?: TiptapNode[] }): string {
  if (!doc.content || doc.content.length === 0) return '';
  return doc.content.map(block).filter((s) => s.trim()).join('\n\n') + '\n';
}
