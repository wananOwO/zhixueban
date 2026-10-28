import { LearnPage } from '@/components/learn/learn-page';

export const metadata = { title: '学习' };

export default async function Page({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ point?: string }>;
}) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  return <LearnPage sessionId={decodeURIComponent(sessionId)} focusPoint={query.point} />;
}
