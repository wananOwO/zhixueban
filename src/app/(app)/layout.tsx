import { AccessGate } from '@/components/shell/access-gate';
import { TopBar } from '@/components/shell/top-bar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        跳到主内容
      </a>
      <AccessGate>
        <TopBar />
        <main id="main" className="px-6 pb-16 max-md:px-4">{children}</main>
      </AccessGate>
    </>
  );
}
