import { CoursePage } from '@/components/courses/course-page';

export const metadata = { title: '课程' };

export default async function Page({ params, searchParams }: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ tab?: string; versionId?: string }>;
}) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  return <CoursePage courseId={decodeURIComponent(courseId)} initialTab={query.tab} versionId={query.versionId} />;
}
