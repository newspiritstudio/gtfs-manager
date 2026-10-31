/**
 * Traducció per clau amb punts («nav.routes») i variables entre claus («{count} línies»). Un valor
 * pot ser un objecte de plurals (`one`, `other`, i opcionalment `zero`) quan hi ha `count`. Si la
 * clau no existeix a l'idioma triat, es fa servir el català; si tampoc, la clau mateixa.
 */
export type Messages = { [key: string]: string | Messages };
export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;

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
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) => {
      const v = vars[name];
      if (v === undefined) return match;
      return typeof v === 'number' ? numbers.format(v) : v;
    });
  };
}
