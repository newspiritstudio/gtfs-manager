/**
 * The browser driver: SQLite compiled to WebAssembly, with the database in the origin private
 * file system through the "SAH pool" VFS, which needs no special HTTP headers (so any static
 * host serves the app). Without OPFS (an old browser, some private windows) the database lives
 * in memory and is lost on reload.
 *
 * Only one worker at a time can hold the database files, so the tabs of the app take turns, like
 * WhatsApp Web: a Web Lock (`gtfs-manager-database`) says who holds it, and a BroadcastChannel
 * lets a tab ask the holder to let go ("Use here"). The holder finishes its writes, closes the
 * database, pauses the VFS (which releases the file handles but keeps the files) and drops the
 * lock; the asking tab, queued on the lock, then opens it. Taking the lock before touching the
 * VFS also means no failed attempts to open it (sqlite-wasm logs an error for each one).
 *
 * A tab that finds the database held waits a few seconds when nobody answers a ping (the
 * previous page of a reload is still going away) and otherwise reports `busy` at once. It never
 * falls back to memory: that would show an empty app over the visitor's saved feeds.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { EngineStorage } from '../protocol';
import type { Driver } from './sql';

const FILE = '/gtfs-manager.sqlite3';
const LOCK = 'gtfs-manager-database';
const CHANNEL = 'gtfs-manager-database';
/** How long a new tab waits for a holder that does not answer (a page going away). */
const WAIT_MS = 10_000;
/** How long a tab that asked for the database waits for the holder to let go. */
const TAKE_OVER_MS = 120_000;
// Without `forceReinitIfPreviouslyFailed` (missing from the typings) a failed attempt is cached
// and every retry fails with it.
const POOL_OPTIONS = { name: 'gtfs-manager', forceReinitIfPreviouslyFailed: true };

export class DatabaseBusyError extends Error {
  override name = 'DatabaseBusy';
  constructor() {
    super('The database is open in another tab');
  }
}

function hasOpfs(): boolean {
  return (
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof globalThis.FileSystemFileHandle?.prototype.createSyncAccessHandle === 'function'
  );
}

const hasLocks = () => typeof navigator.locks?.request === 'function';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite3['installOpfsSAHPoolVfs']>>;
type Message = { type: 'ping' | 'pong' | 'release'; from: string };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The state of the database in this worker. */
export type DatabaseState = EngineStorage | 'opening';

export class BrowserDatabase {
  state: DatabaseState = 'opening';
  driver: Driver | null = null;

  private sqlite3: Sqlite3 | null = null;
  private pool: Pool | null = null;
  private db: InstanceType<Sqlite3['oo1']['DB']> | null = null;
  private unlock: (() => void) | null = null;
  private readonly id = crypto.randomUUID();
  private readonly channel = hasLocks() ? new BroadcastChannel(CHANNEL) : null;
  private readonly listeners = new Set<(state: DatabaseState) => void>();
  /** The worker's chance to finish what it is writing before the files are let go. */
  beforeRelease: () => Promise<void> = async () => {};

  constructor() {
    this.channel?.addEventListener('message', ({ data }: MessageEvent<Message>) => {
      if (data.from === this.id) return;
      if (data.type === 'ping' && this.unlock && this.state === 'opfs') this.send('pong');
      if (data.type === 'release' && this.unlock) void this.release();
    });
  }

  onState(listener: (state: DatabaseState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: DatabaseState) {
    if (this.state === state) return;
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  private send(type: Message['type']) {
    this.channel?.postMessage({ type, from: this.id } satisfies Message);
  }

  /** The first opening: the database of this origin, or `busy` when another tab holds it. */
  async open(): Promise<void> {
    this.sqlite3 = await sqlite3InitModule();
    if (!hasOpfs()) {
      this.db = new this.sqlite3.oo1.DB(':memory:', 'c');
      this.driver = this.makeDriver(this.db);
      this.setState('memory');
      return;
    }
    if (hasLocks()) {
      // A live holder answers the pings and we stop waiting; a page that is going away does not.
      if (!(await this.acquire(WAIT_MS, { stopWhenAnswered: true }))) {
        this.setState('busy');
        return;
      }
    }
    try {
      await this.mount();
    } catch (error) {
      this.dropLock();
      if (error instanceof DatabaseBusyError) return this.setState('busy');
      throw error;
    }
  }

  /** "Use here": asks the holder to let go and opens the database in this worker. */
  async takeOver(): Promise<void> {
    if (this.state === 'opfs' || this.state === 'memory') return;
    if (!this.sqlite3) throw new DatabaseBusyError();
    if (hasLocks() && !(await this.acquire(TAKE_OVER_MS, { askToRelease: true }))) {
      throw new DatabaseBusyError();
    }
    try {
      await this.mount();
    } catch (error) {
      this.dropLock();
      throw error;
    }
  }

  /** Lets go of the database so another tab can open it. */
  async release(): Promise<void> {
    if (this.state !== 'opfs') return;
    // New requests are refused from now on; what is already running finishes first.
    this.setState('released');
    await this.beforeRelease();
    try {
      this.db?.close();
      this.pool?.pauseVfs();
    } finally {
      this.db = null;
      this.driver = null;
      this.dropLock();
    }
  }

  private dropLock() {
    this.unlock?.();
    this.unlock = null;
  }

  /**
   * Takes the Web Lock. Waits in the lock's queue; while it waits it pings (or asks the holder to
   * release) every half second. Resolves to false if it gave up.
   */
  private async acquire(
    timeout: number,
    how: { stopWhenAnswered?: boolean; askToRelease?: boolean }
  ): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onMessage = ({ data }: MessageEvent<Message>) => {
      if (how.stopWhenAnswered && data.type === 'pong' && data.from !== this.id) controller.abort();
    };
    this.channel?.addEventListener('message', onMessage);
    const knock = () => this.send(how.askToRelease ? 'release' : 'ping');
    knock();
    const interval = setInterval(knock, 500);
    try {
      this.unlock = await new Promise<() => void>((resolve, reject) => {
        navigator.locks
          .request(LOCK, { signal: controller.signal }, () => new Promise<void>((r) => resolve(r)))
          .catch(reject);
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      clearInterval(interval);
      this.channel?.removeEventListener('message', onMessage);
    }
  }

  /** Opens the files (the lock is ours) and the database. */
  private async mount(): Promise<void> {
    const sqlite3 = this.sqlite3!;
    if (this.pool) await this.pool.unpauseVfs();
    else this.pool = await this.installPool(sqlite3);
    this.db = new this.pool.OpfsSAHPoolDb(FILE);
    // Fewer fsyncs: the database is a local working copy, and a crash loses at most the last change.
    this.db.exec(
      'PRAGMA journal_mode = TRUNCATE; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -65536'
    );
    this.driver = this.makeDriver(this.db);
    this.setState('opfs');
  }

  /**
   * With the lock the files are ours, but the browser can take a moment to close the handles of
   * a worker that has just gone (a reload) or, without Web Locks, of another tab.
   */
  private async installPool(sqlite3: Sqlite3): Promise<Pool> {
    const deadline = Date.now() + WAIT_MS;
    for (let delay = 100; ; delay = Math.min(delay * 2, 1000)) {
      try {
        return await sqlite3.installOpfsSAHPoolVfs(POOL_OPTIONS);
      } catch {
        if (Date.now() + delay > deadline) throw new DatabaseBusyError();
        await pause(delay);
      }
    }
  }

  private makeDriver(db: InstanceType<Sqlite3['oo1']['DB']>): Driver {
    return {
      query(text, params) {
        const rows: Record<string, unknown>[] = [];
        db.exec({
          sql: text,
          bind: params.length ? (params as never) : undefined,
          rowMode: 'object',
          callback: (row) => {
            rows.push(row as Record<string, unknown>);
          },
        });
        return rows;
      },
      changes: () => db.changes(),
      exec: (text) => {
        db.exec(text);
      },
    };
  }
}
