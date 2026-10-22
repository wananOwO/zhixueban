import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import './globals.css';
import Shell from '@/components/verified-learning/shell';

export const metadata: Metadata = {
  title: '智学伴 — 目标驱动的 AI 学习助手',
  description: '导入教材，按你的学习目标生成个性化课程，学完即考。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-foreground"
          >
            跳到主内容
          </a>
          <Shell>{children}</Shell>
        </ThemeProvider>
      </body>
    </html>
  );
}
