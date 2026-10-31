import { useI18n } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/paths';
import { Link } from '@/lib/router';
import AppLogo from './AppLogo';
import StudioByline from './StudioByline';

export default function BrandMark() {
  const { locale } = useI18n();
  const home = localizedPath(locale, '/');
  // The byline is a link of its own (the studio's site), so it sits beside the home link, not in it.
  // Both are text links in a two-line block: they skip the touch-target floor, as inline links do
  // (WCAG 2.5.8), or the floor would pull the two lines apart.
  return (
    <div className="flex items-center gap-3">
      <Link href={home} tabIndex={-1} aria-hidden className="shrink-0">
        <AppLogo className="size-10" />
      </Link>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={home}
          className="self-start rounded-xs text-title-medium text-on-surface focus-ring !min-h-0 !min-w-0"
        >
          GTFS Manager
        </Link>
        <StudioByline />
      </span>
    </div>
  );
}
