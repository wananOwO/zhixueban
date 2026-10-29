import { HistoryPage } from '@/components/learn/history-page';

export const metadata = { title: '历史回看' };

export default async function Page({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  return <HistoryPage sessionId={decodeURIComponent(sessionId)} runId={query.run} />;
}
