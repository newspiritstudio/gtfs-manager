/**
 * The app's API, served inside the worker: the same `/api/...` routes and handlers a server
 * would have (web `Request` in, `Response` out), found by the folder of each `route.ts`, where
 * `[name]` is a parameter.
 */
import { HISTORY_HEADERS } from '@shared/history';
import { setStepListener, type RecordedStep } from '../history/history';

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> }
) => Response | Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>;

const modules = import.meta.glob<RouteModule>('./**/route.ts', { eager: true });

interface Route {
  pattern: RegExp;
  names: string[];
  module: RouteModule;
  /** Fixed segments first: `/tables/[table]` must not swallow a fixed sibling. */
  weight: number;
}

const routes: Route[] = Object.entries(modules)
  .map(([file, module]) => {
    const segments = file
      .replace(/^\.\//, '')
      .replace(/\/?route\.ts$/, '')
      .split('/')
      .filter(Boolean);
    const names: string[] = [];
    const source = segments
      .map((segment) => {
        const param = /^\[(\w+)\]$/.exec(segment);
        if (!param) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(param[1]);
        return '([^/]+)';
      })
      .join('/');
    return {
      pattern: new RegExp(`^/api/${source}/?$`),
      names,
      module,
      weight: segments.length * 10 - names.length,
    };
  })
  .sort((a, b) => b.weight - a.weight);

function withStepHeaders(response: Response, step: RecordedStep): Response {
  const headers = new Headers(response.headers);
  headers.set(HISTORY_HEADERS.step, String(step.id));
  headers.set(HISTORY_HEADERS.label, encodeURIComponent(step.label));
  headers.set(HISTORY_HEADERS.rows, String(step.rows));
  // Header values are ISO-8859-1: the params travel percent-encoded.
  headers.set(HISTORY_HEADERS.params, encodeURIComponent(JSON.stringify(step.params ?? {})));
  return new Response(response.body, { status: response.status, headers });
}

export async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const handler = route.module[request.method as keyof RouteModule];
    if (!handler) return Response.json({ error: 'methodNotAllowed' }, { status: 405 });
    const params = Object.fromEntries(
      route.names.map((name, i) => [name, decodeURIComponent(match[i + 1])])
    );
    // A write that opts into the edit history (`withHistory`) reports its step in the response
    // headers, so the page can offer "Undo" without every route repeating it. Writes run one at
    // a time in the worker, so one listener at a time is enough.
    let recorded = null as RecordedStep | null;
    const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
    if (isWrite) setStepListener((step) => (recorded = step));
    try {
      const response = await handler(request, { params: Promise.resolve(params) });
      return recorded ? withStepHeaders(response, recorded) : response;
    } catch (error) {
      console.error(`${request.method} ${pathname}`, error);
      return Response.json({ error: 'internal' }, { status: 500 });
    } finally {
      if (isWrite) setStepListener(null);
    }
  }
  return Response.json({ error: 'notFound' }, { status: 404 });
}
