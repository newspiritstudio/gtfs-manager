import { GallerySkeleton } from '@/components/skeletons/PageSkeletons';

export default function Loading() {
  return <GallerySkeleton count={9} stats={0} toolbar />;
}
