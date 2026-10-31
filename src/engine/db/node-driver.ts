/** The driver over Node's built-in SQLite, for tests and scripts. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Driver } from './sql';

export function nodeDriver(path = ':memory:'): Driver {
  const db = new DatabaseSync(path);
  let changes = 0;
  return {
    query(text, params) {
      const statement = db.prepare(text);
      const values = params as SQLInputValue[];
      if (statement.columns().length) return statement.all(...values) as Record<string, unknown>[];
      changes = Number(statement.run(...values).changes);
      return [];
    },
    changes: () => changes,
    exec: (text) => db.exec(text),
  };
}
