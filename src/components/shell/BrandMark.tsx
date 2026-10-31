import Link from 'next/link';
import AppLogo from './AppLogo';
import StudioByline from './StudioByline';

export default function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-md focus-ring">
      <AppLogo className="size-10 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-title-medium text-on-surface">GTFS Manager</span>
        <StudioByline />
      </span>
    </Link>
  );
}
