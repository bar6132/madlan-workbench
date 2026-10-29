// Pure logic for "propose a correction": validation, what-if recompute, suggestions and the texts handed to R&D.
// No file access, so it is safe in the browser bundle. Nothing here writes data: a correction is only ever a
// proposal; approved ones are applied to a COPY of the CSV by scripts/apply_corrections.py.
//
// applyCorrection re-implements the price-dependent rules of scripts/build_dataset.py (the single source of
// truth). tests/corrections-parity.test.ts runs the real Python pipeline on a corrected CSV and requires an
// identical result, so the two cannot drift silently.
import { z } from 'zod';
import type { ProcessedDeal, RawRow } from './types';

export const MIN_PRICE = 250_000;
const PPSM_TOLERANCE = 0.01;
const SOURCE_ORDER = ['רשות המסים', 'מתווך', 'בעל נכס'];

export const CorrectionFieldSchema = z.enum(['price_nis', 'size_sqm', 'price_per_sqm']);
export type CorrectionField = z.infer<typeof CorrectionFieldSchema>;

export const fieldInfo: Record<CorrectionField, { he: string; column: string; min: number; max: number; verdictField: 'price' | 'size' | 'price_per_sqm' }> = {
  price_nis: { he: 'מחיר העסקה (₪)', column: 'price_nis', min: 1, max: 1e10, verdictField: 'price' },
  size_sqm: { he: 'שטח (מ"ר)', column: 'size_sqm', min: 10, max: 2000, verdictField: 'size' },
  price_per_sqm: { he: 'מחיר למ"ר (₪)', column: 'price_per_sqm', min: 1000, max: 1_000_000, verdictField: 'price_per_sqm' },
};

export const CorrectionSchema = z.object({
  deal_id: z.string().regex(/^D\d{6}$/),
  row_index: z.number().int().min(0),
  field: CorrectionFieldSchema,
  new_value: z.number().int(),
  reason: z.string().trim().min(5).max(300),
  source_of_info: z.string().trim().min(3).max(200),
});
export type Correction = z.infer<typeof CorrectionSchema>;

// ---------- number helpers, matching the Python pipeline ----------

/** Python's round(): halves go to the even neighbour, unlike Math.round. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function ppsmOf(price: number | null, size: number | null): number | null {
  return price && size && price > 0 && size > 0 ? roundHalfEven(price / size) : null;
}

const mismatch = (calc: number | null, csv: number | null) =>
  calc !== null && csv !== null && Math.abs(calc - csv) / calc > PPSM_TOLERANCE;

const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString('en-US'));

// ---------- validation ----------

export function currentValue(row: RawRow, field: CorrectionField): number | null {
  return field === 'price_nis' ? row.price_nis : field === 'size_sqm' ? row.size_sqm : row.csv_price_per_sqm;
}

export function validateCorrection(deal: ProcessedDeal, c: Correction): string[] {
  const errors: string[] = [];
  const row = deal.raw_rows.find((r) => r.row_index === c.row_index);
  if (!row) return ['השורה שנבחרה אינה שייכת לעסקה זו.'];
  const info = fieldInfo[c.field];
  if (c.new_value < info.min || c.new_value > info.max) {
    errors.push(`${info.he}: הערך חייב להיות בין ${fmt(info.min)} ל-${fmt(info.max)}.`);
  }
  if (currentValue(row, c.field) === c.new_value) errors.push('הערך המוצע זהה לערך שבקובץ.');
  return errors;
}

// ---------- what-if recompute ----------

function choosePrimary(rows: RawRow[]): { index: number; reason: ProcessedDeal['primary_reason'] } {
  if (rows.length === 1) return { index: 0, reason: 'SINGLE' };
  const same = (a: RawRow, b: RawRow) =>
    a.source === b.source && a.price_nis === b.price_nis && a.size_sqm === b.size_sqm &&
    a.csv_price_per_sqm === b.csv_price_per_sqm && a.deal_date_raw === b.deal_date_raw;
  if (rows.every((r) => same(r, rows[0]))) return { index: 0, reason: 'EXACT_DUP' };
  const matching = rows.flatMap((r, i) => {
    const c = ppsmOf(r.price_nis, r.size_sqm);
    return c !== null && r.csv_price_per_sqm !== null && Math.abs(c - r.csv_price_per_sqm) <= 1 ? [i] : [];
  });
  if (matching.length === 1) return { index: matching[0], reason: 'PPSM_MATCH' };
  const rank = (i: number) => {
    const k = SOURCE_ORDER.indexOf(rows[i].source);
    return k === -1 ? SOURCE_ORDER.length : k;
  };
  const order = rows.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
  return { index: order[0], reason: 'SOURCE_ORDER' };
}

// Flags that do not depend on price, size or price per m² are carried over unchanged.
const KEPT = ['CITY_NORMALIZED', 'MONTH_ONLY_DATE', 'TIMELINE_CONTRADICTION', 'NEW_BUILD_OLD_YEAR'];

/** The deal as the pipeline would build it if the correction were in the CSV. PPSM_OUTLIER is dataset-wide: see note in the UI. */
export function applyCorrection(deal: ProcessedDeal, c: Correction): ProcessedDeal {
  const rows: RawRow[] = deal.raw_rows.map((r) => {
    if (r.row_index !== c.row_index) return r;
    if (c.field === 'price_nis') return { ...r, price_nis: c.new_value, price_nis_raw: String(c.new_value) };
    if (c.field === 'size_sqm') return { ...r, size_sqm: c.new_value };
    return { ...r, csv_price_per_sqm: c.new_value };
  });
  const { index, reason } = choosePrimary(rows);
  const p = rows[index];
  const price = p.price_nis;
  const size = p.size_sqm;
  const calc = ppsmOf(price, size);

  const old = new Map(deal.flags.map((f, i) => [f, deal.explanations_he[i]] as const));
  const flags: string[] = [];
  const ex: string[] = [];
  const add = (f: string, t: string) => { flags.push(f); ex.push(t); };
  const keep = (f: string) => { const t = old.get(f); if (t !== undefined) add(f, t); };

  if (reason === 'EXACT_DUP') add('EXACT_DUPLICATE', 'הרשומה הופיעה בקובץ יותר מפעם אחת בדיוק באותם נתונים; נספרה פעם אחת.');
  if (reason === 'PPSM_MATCH' || reason === 'SOURCE_ORDER') {
    const o = rows.find((_, i) => i !== index)!;
    const why = reason === 'PPSM_MATCH'
      ? 'המחיר למ"ר שנרשם בקובץ תואם לרשומה זו'
      : 'לפי סדר עדיפות המקורות (רשות המסים, מתווך, בעל נכס) — זו הנחה של המערכת ולא נתון מהקובץ';
    add('SOURCE_CONFLICT',
      `לעסקה זו שתי רשומות בקובץ עם מחירים שונים: ${p.source} ₪${fmt(price)} ו-${o.source} ₪${fmt(o.price_nis)}. המערכת מציגה את רשומת ${p.source} כי ${why}.`);
  }
  keep('CITY_NORMALIZED');
  keep('MONTH_ONLY_DATE');
  if (size === null) add('MISSING_SIZE', 'שטח הדירה חסר בקובץ; לא ניתן לחשב מחיר למ"ר.');
  if (mismatch(calc, p.csv_price_per_sqm)) {
    add('PPSM_MISMATCH', `המחיר למ"ר שנרשם בקובץ (₪${fmt(p.csv_price_per_sqm)}) אינו תואם למחיר חלקי שטח (₪${fmt(calc)}). המערכת משתמשת בערך המחושב.`);
  }
  let excluded = false;
  if (!price) {
    excluded = true;
    add('PRICE_INVALID', 'מחיר העסקה חסר או אפס; העסקה אינה נכללת בחישובי שוק.');
  } else if (price < MIN_PRICE) {
    excluded = true;
    add('PRICE_BELOW_THRESHOLD', `מחיר העסקה (₪${fmt(price)}) נמוך מ-₪${fmt(MIN_PRICE)}, נמוך מכדי להיות מחיר רכישה אופייני; העסקה אינה נכללת בחישובי שוק.`);
  }
  keep('TIMELINE_CONTRADICTION');
  keep('NEW_BUILD_OLD_YEAR');
  if (calc === deal.calculated_ppsm) keep('PPSM_OUTLIER');

  return {
    ...deal,
    raw_rows: rows,
    primary_row_index: index,
    primary_reason: reason,
    price_nis: price,
    size_sqm: size,
    csv_price_per_sqm: p.csv_price_per_sqm,
    calculated_ppsm: calc,
    source: p.source,
    flags, explanations_he: ex,
    status: excluded ? 'EXCLUDED' : flags.includes('SOURCE_CONFLICT') ? 'CONFLICT' : 'VALID',
    include_in_stats: !excluded,
  };
}

// ---------- suggestions ("auto fix"): only values that can be derived, never guessed ----------

export interface Suggestion {
  row_index: number;
  field: CorrectionField;
  value: number;
  label_he: string;
  assumption_he: string;
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  cannot_derive_he: string[];
}

export function suggestFixes(deal: ProcessedDeal): SuggestionResult {
  const suggestions: Suggestion[] = [];
  for (const r of deal.raw_rows) {
    const calc = ppsmOf(r.price_nis, r.size_sqm);
    if (calc !== null && r.csv_price_per_sqm !== null && mismatch(calc, r.csv_price_per_sqm)) {
      suggestions.push({
        row_index: r.row_index,
        field: 'price_per_sqm',
        value: calc,
        label_he: `עדכון המחיר למ"ר בקובץ מ-${fmt(r.csv_price_per_sqm)} ל-${fmt(calc)} (מחיר העסקה ÷ השטח)`,
        assumption_he: 'בהנחה שהמחיר והשטח שנרשמו נכונים. אם אחד מהם שגוי, אין בקובץ דרך לדעת איזה.',
      });
    }
  }
  const cannot: string[] = [];
  if (deal.flags.includes('PRICE_INVALID') || deal.flags.includes('PRICE_BELOW_THRESHOLD')) {
    cannot.push('המחיר הנכון של העסקה אינו מופיע בקובץ ולכן אי אפשר לחשב אותו. כדי להציע תיקון יש להזין את המחיר הנכון ולציין ממה הוא נלקח.');
  }
  if (deal.flags.includes('MISSING_SIZE')) {
    cannot.push('שטח הדירה חסר בקובץ ואי אפשר להסיק אותו. כדי להציע תיקון יש להזין את השטח ולציין ממה הוא נלקח.');
  }
  return { suggestions, cannot_derive_he: cannot };
}

// ---------- what R&D receives ----------

export const csvLine = (c: Correction) => c.row_index + 2; // header is line 1, rows are 0-based

export function jsonEntry(c: Correction, oldValue: number | null) {
  return {
    deal_id: c.deal_id, row_index: c.row_index, field: c.field, old_value: oldValue, new_value: c.new_value,
    reason: c.reason, source_of_info: c.source_of_info,
    approved_by: null as string | null, approved_at: null as string | null,
  };
}

export function requestText(deal: ProcessedDeal, c: Correction, change_lines_he: string[], trace_id?: string): string {
  const row = deal.raw_rows.find((r) => r.row_index === c.row_index)!;
  const old = currentValue(row, c.field);
  return [
    'בקשת תיקון נתונים (הצעה בלבד, טרם אושרה)',
    `עסקה: ${deal.deal_id}, שורה ${csvLine(c)} בקובץ (הדיווח של ${row.source})`,
    `פרטי העסקה: ${[
      [deal.street, deal.neighborhood, deal.city].filter(Boolean).join(', '),
      deal.property_type,
      deal.rooms !== null ? `${deal.rooms} חדרים` : null,
      deal.size_sqm !== null ? `${deal.size_sqm} מ"ר` : null,
      deal.deal_date,
    ].filter(Boolean).join(' · ')}`,
    `שדה: ${fieldInfo[c.field].he}`,
    `ערך בקובץ: ${fmt(old)}  ←  ערך מוצע: ${fmt(c.new_value)}`,
    `סיבה: ${c.reason}`,
    `מקור המידע: ${c.source_of_info}`,
    ...(change_lines_he.length ? ['השפעה צפויה:', ...change_lines_he.map((l) => `• ${l}`)] : []),
    'לא בוצע שינוי בקובץ המקור. תיקון מאושר נכנס לעותק v2 בלבד, דרך scripts/apply_corrections.py.',
    ...(trace_id ? [`מזהה מעקב: ${trace_id}`] : []),
  ].join('\n');
}
