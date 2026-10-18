import { Suspense } from 'react';
import NewCourseForm from './new-course-form';

export default async function NewCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ textbookId?: string }>;
}) {
  const { textbookId } = await searchParams;
  return (
    <Suspense>
      <NewCourseForm initialTextbookId={textbookId ?? ''} />
    </Suspense>
  );
}
