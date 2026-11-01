/** Messages between the page (`src/lib/engine.ts`) and the engine's worker (`worker.ts`). */

/**
 * Where the database lives: the origin private file system, memory (lost on reload, in a browser
 * without OPFS), nowhere because another tab holds it (`busy`), or nowhere because this tab let
 * go of it when another one asked (`released`).
 */
export type EngineStorage = 'opfs' | 'memory' | 'busy' | 'released';

/** The error name of every request while the database is held by another tab. */
export const DATABASE_BUSY = 'DatabaseBusy';

export type EngineRequest =
  | { id: number; kind: 'status' }
  /** "Use here": takes the database from the tab that holds it. */
  | { id: number; kind: 'takeover' }
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
  | { id: number; kind: 'error'; error: { name: string; message: string } }
  /** Not an answer: the database's state changed (another tab asked for it, or gave it back). */
  | { kind: 'event'; name: 'storage'; storage: EngineStorage };
