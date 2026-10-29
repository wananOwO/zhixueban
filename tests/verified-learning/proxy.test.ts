import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '@/proxy';

afterEach(() => vi.unstubAllEnvs());

const page = (path = '/courses') => new NextRequest(`http://127.0.0.1:3101${path}`);
const directives = (csp: string) => Object.fromEntries(csp.split(';').map(d => d.trim()).filter(Boolean).map(d => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

describe('proxy：页面响应的安全头', () => {
  it('每个请求一个新的 nonce；CSP 只允许本站脚本与带 nonce 的脚本，禁止被嵌入', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const a = proxy(page());
    const b = proxy(page());
    const csp = a.headers.get('content-security-policy')!;
    const d = directives(csp);
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(nonce).not.toBe(/'nonce-([^']+)'/.exec(b.headers.get('content-security-policy')!)![1]);
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['script-src']).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(d['connect-src']).toEqual(["'self'"]);
    expect(d['font-src']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(csp).not.toContain('unsafe-eval');
    // Next 从请求头里的 CSP 取 nonce 注入框架脚本
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
  });

  it('其他安全头', () => {
    const r = proxy(page('/'));
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('开发模式允许 eval（React 调试需要），生产不允许', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(proxy(page()).headers.get('content-security-policy')).toContain("'unsafe-eval'");
  });

  it('matcher 排除 API、静态资源与预取请求', () => {
    const [rule] = config.matcher;
    const pattern = new RegExp(`^${rule.source}$`);
    for (const path of ['/', '/courses', '/learn/s1/history']) expect(pattern.test(path)).toBe(true);
    for (const path of ['/api/verified-learning/v1/mode', '/_next/static/chunks/a.js', '/_next/image', '/favicon.ico']) expect(pattern.test(path)).toBe(false);
    expect(rule.missing).toEqual(expect.arrayContaining([{ type: 'header', key: 'next-router-prefetch' }]));
  });
});
