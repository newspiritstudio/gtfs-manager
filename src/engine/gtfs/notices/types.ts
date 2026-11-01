import type { NoticeContext } from './context';

/**
 * A group of notice rules that share the tables they read. `codes` are the notice codes the group
 * can emit (the coverage test checks that every code of the canonical catalog is in one group or
 * in the skip list of `index.ts`).
 */
export interface NoticeFamily {
  name: string;
  codes: readonly string[];
  run: (ctx: NoticeContext) => Promise<void>;
}
