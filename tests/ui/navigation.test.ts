import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import RootLayout from '@/app/layout';
import { resetDbForTest } from '@/lib/db';
import CoursesPage from '@/app/courses/page';
import NewCourseForm from '@/app/courses/new/new-course-form';
import StatsPage from '@/app/stats/page';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

describe('站内导航与空状态入口', () => {
  beforeEach(() => {
    pathname = '/';
    resetDbForTest();
    vi.stubEnv('DB_PATH', ':memory:');
  });
  afterEach(() => {
    resetDbForTest();
    vi.unstubAllEnvs();
  });

  test('每个页面的共享布局都有五个功能入口', () => {
    const html = renderToStaticMarkup(createElement(RootLayout, { children: createElement('main', { id: 'main' }) }));
    for (const path of ['/', '/textbooks', '/courses', '/stats', '/settings']) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html).toContain('aria-label="主导航"');
  });

  test('学习页面正确高亮我的课程，并提供手机菜单按钮', () => {
    pathname = '/learn/example';
    const html = renderToStaticMarkup(createElement(RootLayout, { children: null }));
    const activeLinks = (html.match(/<a\b[^>]*>/g) ?? []).filter((tag) => tag.includes('aria-current="page"'));
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toContain('href="/courses"');
    expect(html).toContain('aria-controls="app-navigation"');
  });

  test('没有课程、教材、学习数据时的提示包含下一步入口', () => {
    expect(renderToStaticMarkup(createElement(CoursesPage))).toContain('href="/textbooks"');
    expect(renderToStaticMarkup(createElement(NewCourseForm, { initialTextbookId: '' }))).toContain('href="/textbooks"');
    expect(renderToStaticMarkup(createElement(StatsPage))).toContain('href="/courses/new"');
  });
});
