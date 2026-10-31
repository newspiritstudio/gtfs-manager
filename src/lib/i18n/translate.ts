/**
 * Translation by dotted key ("nav.routes") and variables in braces ("{count} lines"). A value
 * can be a plurals object (`one`, `other`, and optionally `zero`) when `count` is present. If
 * the key does not exist in the chosen language, Catalan is used; if not there either, the key
 * itself.
 *
 * One-letter words ("i", "o", "a", "y", "e"...) are glued to the next one with a non-breaking
 * space: a line must not end with a stray conjunction or preposition.
 */
export type Messages = { [key: string]: string | Messages };
export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;

const SHORT_WORD = /(^|[\s(«“"])(\p{L}) /gu;

export function keepShortWords(text: string): string {
  return text.replace(SHORT_WORD, '$1$2\u00a0');
}

function lookup(messages: Messages, key: string): string | Messages | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

export function createTranslator(
  locale: string,
  messages: Messages,
  fallback?: Messages
): Translate {
  const plural = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  return (key, vars) => {
    let value = lookup(messages, key) ?? (fallback ? lookup(fallback, key) : undefined);
    if (value && typeof value === 'object' && vars && typeof vars.count === 'number') {
      const forms = value as Record<string, string>;
      value = (vars.count === 0 && forms.zero) || forms[plural.select(vars.count)] || forms.other;
    }
    if (typeof value !== 'string') return key;
    value = keepShortWords(value);
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) => {
      const v = vars[name];
      if (v === undefined) return match;
      return typeof v === 'number' ? numbers.format(v) : v;
    });
  };
}
