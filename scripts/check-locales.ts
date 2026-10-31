/**
 * Comprova els textos de la interfície: tots els idiomes de `LOCALES` han de tenir exactament les
 * mateixes claus que el català, i cada `t('clau')` literal del codi ha d'existir. Un objecte de plurals
 * (`one`/`other`) compta com una sola clau.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES } from '../src/lib/i18n/config';

type Messages = { [key: string]: string | Messages };
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function isPlural(node: Messages): boolean {
  const keys = Object.keys(node);
  return keys.includes('other') && keys.every((k) => PLURAL_FORMS.has(k));
}

function flatten(node: Messages, prefix = '', out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' || isPlural(value)) out.add(path);
    else flatten(value, path, out);
  }
  return out;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
  }
  return files;
}

const root = process.cwd();
const keys = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    flatten(JSON.parse(readFileSync(join(root, 'src/locales', `${l}.json`), 'utf8'))),
  ])
) as Record<(typeof LOCALES)[number], Set<string>>;

const problems: string[] = [];
for (const locale of LOCALES.slice(1)) {
  for (const k of keys.ca) if (!keys[locale].has(k)) problems.push(`${locale}: falta «${k}»`);
  for (const k of keys[locale]) if (!keys.ca.has(k)) problems.push(`${locale}: sobra «${k}»`);
}

// Cada traducció ha de portar les mateixes variables ({count}, {name}...) que el català.
function lookup(node: Messages, key: string): string | Messages | undefined {
  let value: string | Messages | undefined = node;
  for (const part of key.split('.')) value = typeof value === 'object' ? value[part] : undefined;
  return value;
}
function placeholders(value: string | Messages | undefined): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join(' ');
}
const sources = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(root, 'src/locales', `${l}.json`), 'utf8'))])
) as Record<(typeof LOCALES)[number], Messages>;
for (const locale of LOCALES.slice(1)) {
  for (const k of keys.ca) {
    if (!keys[locale].has(k)) continue;
    const expected = placeholders(lookup(sources.ca, k));
    const actual = placeholders(lookup(sources[locale], k));
    if (expected !== actual)
      problems.push(`${locale}: «${k}» té les variables [${actual}] i el català [${expected}]`);
  }
}

const pattern = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;
for (const file of ['app', 'src', 'shared'].flatMap((d) => walk(join(root, d)))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(pattern)) {
    if (!keys.ca.has(match[1]))
      problems.push(`${file.slice(root.length + 1)}: clau inexistent «${match[1]}»`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problemes als textos.`);
  process.exit(1);
}
console.log(`Textos correctes: ${keys.ca.size} claus en ${LOCALES.length} idiomes.`);
