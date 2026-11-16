import { CoursePage } from '@/components/courses/course-page';

export const metadata = { title: '课程' };

export default async function Page({ params }: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <CoursePage courseId={decodeURIComponent(courseId)} />;
}
