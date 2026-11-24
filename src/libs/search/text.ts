/**
 * Uzbek-aware text helpers for book search.
 *
 * Readers type the same title in many ways: "Oʻtkan kunlar", "O'tkan kunlar",
 * "Otkan kunlar", "Ўткан кунлар". The search index strips apostrophe-like
 * characters and folds case/diacritics; queries are expanded into a Latin and a
 * Cyrillic variant so either script finds books written in the other.
 */

/** Every character people use for the Uzbek tutuq belgisi / oʻ, gʻ */
export const APOSTROPHES = ["ʻ", "ʼ", "'", "’", "‘", "`", "´", "ʹ"];
const APOSTROPHE_RE = new RegExp(`[${APOSTROPHES.join("")}]`, "g");

export const MAX_QUERY_LENGTH = 100;

/** Trim, collapse spaces, NFC, one apostrophe form, lower case */
export const normalizeQuery = (raw: unknown): string =>
  String(raw ?? "")
    .normalize("NFC")
    .replace(APOSTROPHE_RE, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_LENGTH);

export const stripApostrophes = (text: string) => text.replace(APOSTROPHE_RE, "");

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const LATIN_RE = /[a-z]/i;

/** Uzbek Cyrillic (and plain Russian letters) -> Uzbek Latin */
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g'", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y",
  к: "k", қ: "q", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o'",
  ф: "f", х: "x", ҳ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "'", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
};

export const toLatin = (text: string): string => {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // "е" at the start of a word sounds "ye" (Ер -> Yer)
    if (ch === "е" && (i === 0 || /[\s\-"«(]/.test(text[i - 1]))) out += "ye";
    else out += CYR_TO_LAT[ch] ?? ch;
  }
  return out;
};

/** Uzbek Latin -> Cyrillic. Digraphs first: "sh" is ш, not с+ҳ. */
const LAT_DIGRAPHS: [RegExp, string][] = [
  [/o'/g, "ў"], [/g'/g, "ғ"], [/sh/g, "ш"], [/ch/g, "ч"], [/yo/g, "ё"], [/yu/g, "ю"], [/ya/g, "я"], [/ye/g, "е"], [/ts/g, "ц"],
];
const LAT_TO_CYR: Record<string, string> = {
  a: "а", b: "б", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н",
  o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з", "'": "ъ",
};

export const toCyrillic = (text: string): string => {
  let out = text;
  for (const [re, cyr] of LAT_DIGRAPHS) out = out.replace(re, cyr);
  return out.replace(/[a-z']/g, (ch) => LAT_TO_CYR[ch] ?? ch);
};

/**
 * The spellings a query should be searched as: the query itself and its form
 * in the other script, all without apostrophes (the index drops them too).
 */
export const queryVariants = (raw: unknown): string[] => {
  const q = normalizeQuery(raw);
  if (!q) return [];
  const variants = new Set<string>([stripApostrophes(q)]);
  if (CYRILLIC_RE.test(q)) variants.add(stripApostrophes(toLatin(q)));
  if (LATIN_RE.test(q)) variants.add(stripApostrophes(toCyrillic(q)).replace(/ъ/g, ""));
  return [...variants].filter((v) => v.trim().length > 0);
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regex for the fallback search (no Atlas Search): matches the variant
 * case-insensitively with an optional apostrophe after every letter, so
 * "otkan" finds "Oʻtkan". Built from escaped text only — no user regex.
 */
export const apostropheInsensitiveRegex = (variant: string): RegExp => {
  const optional = `[${APOSTROPHES.join("")}]?`;
  const body = [...variant].map((ch) => (ch === " " ? "\\s+" : escapeRegex(ch) + optional)).join("");
  return new RegExp(body, "i");
};
