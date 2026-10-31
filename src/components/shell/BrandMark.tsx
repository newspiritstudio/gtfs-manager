import { useI18n } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/paths';
import { Link } from '@/lib/router';
import AppLogo from './AppLogo';
import StudioByline from './StudioByline';

export default function BrandMark() {
  const { locale } = useI18n();
  return (
    <Link
      href={localizedPath(locale, '/')}
      className="flex items-center gap-3 rounded-md focus-ring"
    >
      <AppLogo className="size-10 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-title-medium text-on-surface">GTFS Manager</span>
        <StudioByline />
      </span>
    </Link>
  );
}
