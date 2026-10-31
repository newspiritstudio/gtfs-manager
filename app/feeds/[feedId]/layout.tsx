import { notFound } from 'next/navigation';
import { getFeed } from '@/server/gtfs/feeds';

export default async function FeedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ feedId: string }>;
}) {
  const { feedId } = await params;
  const feed = await getFeed(feedId);
  if (!feed) notFound();
  return children;
}
