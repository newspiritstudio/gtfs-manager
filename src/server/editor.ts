import { cookies } from 'next/headers';
import { EDITOR_COOKIE } from '@/lib/editor-config';

/**
 * Whether to show the editing controls (import, edit, delete, generate).
 *
 * With `EDITOR_GATE=proxy`, every change already needs the editor's password at the proxy
 * (non-GET `/api/*`), and so does `/editor`, which sets the cookie. Without the cookie, the site
 * only shows what anyone may do: reading. The cookie only hides or shows controls; the password
 * at the proxy is what protects the data.
 *
 * Without `EDITOR_GATE` (development, or an instance without that proxy) everything is shown.
 */
export async function isEditor(): Promise<boolean> {
  if (process.env.EDITOR_GATE !== 'proxy') return true;
  return (await cookies()).get(EDITOR_COOKIE)?.value === '1';
}
