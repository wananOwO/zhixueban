import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from '@/components/providers';

export const metadata: Metadata = {
  title: { default: '智学伴 — 每句话都有出处的 AI 学习平台', template: '%s · 智学伴' },
  description: '导入教材、写下学习目标，Agent 读书编课，每句讲解都标明出自原书第几段，掌握要用不同的题证明。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f3f3f1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
