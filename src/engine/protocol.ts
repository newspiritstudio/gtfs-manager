/** Messages between the page (`src/lib/engine.ts`) and the engine's worker (`worker.ts`). */

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
