import type { Metadata } from 'next';
import { PRIVATE_ROBOTS } from '@/server/seo';

/** Feeds are each installation's workspace: they are not indexed. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

export default function FeedsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
