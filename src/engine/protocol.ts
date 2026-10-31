/** Messages between the page (`src/lib/engine.ts`) and the engine's worker (`worker.ts`). */

/**
 * Where the database lives: the origin private file system, memory (lost on reload, in a browser
 * without OPFS), or nowhere yet because another tab holds it.
 */
export type EngineStorage = 'opfs' | 'memory' | 'busy';

/** The error name of every request while the database is held by another tab. */
export const DATABASE_BUSY = 'DatabaseBusy';

export type EngineRequest =
  | { id: number; kind: 'status' }
  | { id: number; kind: 'call'; name: string; args: unknown[] }
  | {
      id: number;
      kind: 'fetch';
      url: string;
      method: string;
      headers: [string, string][];
      body: Blob | string | null;
    };

export type EngineReply =
  | { id: number; kind: 'result'; value: unknown }
  | {
      id: number;
      kind: 'response';
      status: number;
      headers: [string, string][];
      body: Blob | null;
    }
  | { id: number; kind: 'error'; error: { name: string; message: string } };
