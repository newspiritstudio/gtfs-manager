import type { Metadata } from 'next';
import { PRIVATE_ROBOTS } from '@/server/seo';

/** Els feeds són l'espai de treball de cada instal·lació: no s'indexen. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

export default function FeedsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
