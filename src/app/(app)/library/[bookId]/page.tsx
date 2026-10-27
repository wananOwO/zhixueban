import { BookDetail } from '@/components/library/book-detail';

export const metadata = { title: '教材' };

export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  return <BookDetail bookId={decodeURIComponent(bookId)} />;
}
