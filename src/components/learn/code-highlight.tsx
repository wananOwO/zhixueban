'use client';

import { useEffect, useState } from 'react';

/**
 * 课件代码块语法高亮：shiki 在浏览器里按需加载（JavaScript 正则引擎，不需要 wasm），
 * 只带 Python / JavaScript / C / C++ / Bash 五种语法。加载完成前显示原文。
 * 主题是自定义的墨色主题：关键字加粗、注释次文字色、字符串与数字用深灰绿与深褐，
 * 不引入朱批以外的鲜艳色相（规格 6.2：唯一色相是朱批）。
 */
type Token = { content: string; color?: string; fontStyle?: number };
const LANGS: Record<string, string> = { python: 'python', py: 'python', javascript: 'javascript', js: 'javascript', c: 'c', cpp: 'cpp', 'c++': 'cpp', bash: 'bash', sh: 'bash', shell: 'bash' };

/** 与 code-editor.tsx 共用：对代码底色 #f4f4f1 都在 4.5:1 以上 */
export const CODE_COLORS = {
  text: '#1c1b1a',
  keyword: '#1c1b1a',
  comment: '#5c5b57',
  string: '#3d5c45',
  number: '#6b4a2b',
  func: '#2f4858',
} as const;

const THEME = {
  name: 'zhupi-ink',
  type: 'light' as const,
  colors: { 'editor.background': '#f4f4f1', 'editor.foreground': CODE_COLORS.text },
  settings: [
    { settings: { foreground: CODE_COLORS.text, background: '#f4f4f1' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: CODE_COLORS.comment, fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator.logical'], settings: { foreground: CODE_COLORS.keyword, fontStyle: 'bold' } },
    { scope: ['string', 'string.quoted', 'punctuation.definition.string'], settings: { foreground: CODE_COLORS.string } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character.escape'], settings: { foreground: CODE_COLORS.number } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: CODE_COLORS.func } },
  ],
};

let highlighter: Promise<{ codeToTokensBase: (code: string, options: { lang: string; theme: string }) => Token[][] }> | null = null;
function load() {
  highlighter ??= (async () => {
    const [core, engine, python, javascript, c, cpp, bash] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/dist/langs/python.mjs'),
      import('shiki/dist/langs/javascript.mjs'),
      import('shiki/dist/langs/c.mjs'),
      import('shiki/dist/langs/cpp.mjs'),
      import('shiki/dist/langs/bash.mjs'),
    ]);
    return core.createHighlighterCore({
      themes: [THEME],
      langs: [python.default, javascript.default, c.default, cpp.default, bash.default],
      engine: engine.createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

export function CodeHighlight({ code, language }: { code: string; language?: string }) {
  const lang = language ? LANGS[language.toLowerCase()] : undefined;
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  useEffect(() => {
    if (!lang) return;
    let alive = true;
    load()
      .then(h => { if (alive) setTokens(h.codeToTokensBase(code, { lang, theme: THEME.name })); })
      .catch(() => { /* 高亮失败时保留原文 */ });
    return () => { alive = false; };
  }, [code, lang]);
  if (!tokens) return <code>{code}</code>;
  return (
    <code>
      {tokens.map((line, i) => (
        <span key={i}>
          {line.map((token, j) => (
            // shiki 的 fontStyle 位标记：1 斜体，2 粗体
            <span key={j} style={{ color: token.color, fontStyle: token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined, fontWeight: token.fontStyle && token.fontStyle & 2 ? 600 : undefined }}>{token.content}</span>
          ))}
          {i < tokens.length - 1 && '\n'}
        </span>
      ))}
    </code>
  );
}
