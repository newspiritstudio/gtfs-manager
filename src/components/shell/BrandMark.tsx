import Link from 'next/link';
import AppLogo from './AppLogo';

export default function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-md focus-ring">
      <AppLogo className="size-10 shrink-0" />
      <span className="text-title-medium text-on-surface">GTFS Manager</span>
    </Link>
  );
}
