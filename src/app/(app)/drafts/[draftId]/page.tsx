import { DraftPage } from '@/components/drafts/draft-page';

export const metadata = { title: '课程草稿' };

export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <DraftPage draftId={decodeURIComponent(draftId)} />;
}
