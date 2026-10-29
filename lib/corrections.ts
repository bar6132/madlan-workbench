// Server side of "propose a correction": the what-if preview and the list of approved corrections.
// Proposals are never stored. See lib/correction-core.ts for the rules.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { flagLabel } from './copy';
import {
  CorrectionSchema, applyCorrection, csvLine, currentValue, fieldInfo, jsonEntry, requestText, validateCorrection,
  type Correction,
} from './correction-core';
import { loadDataset } from './data';
import { marketContext, type MarketContext } from './market';
import type { ProcessedDeal } from './types';
import { verdictLabel } from './templates';
import { verifyClaim, type Verdict } from './verifier';

export interface Snapshot {
  status: ProcessedDeal['status'];
  include_in_stats: boolean;
  price_nis: number | null;
  size_sqm: number | null;
  csv_price_per_sqm: number | null;
  calculated_ppsm: number | null;
  flags: string[];
  primary_row_index: number;
}

const snap = (d: ProcessedDeal): Snapshot => ({
  status: d.status, include_in_stats: d.include_in_stats, price_nis: d.price_nis, size_sqm: d.size_sqm,
  csv_price_per_sqm: d.csv_price_per_sqm, calculated_ppsm: d.calculated_ppsm, flags: d.flags,
  primary_row_index: d.primary_row_index,
});

export interface Preview {
  csv_line: number;
  old_value: number | null;
  before: Snapshot;
  after: Snapshot;
  verdict: { field: string; before: Verdict; after: Verdict; before_facts_he: string[]; after_facts_he: string[] };
  market: { before: MarketContext; after: MarketContext };
  change_lines_he: string[];
  notes_he: string[];
  request_text: string;
  json_entry: ReturnType<typeof jsonEntry>;
  csv_patch_he: string;
}

const statusHe: Record<string, string> = { VALID: 'תקינה', CONFLICT: 'סתירה בין מקורות', EXCLUDED: 'מוחרגת מהסטטיסטיקה' };
const n = (x: number | null) => (x === null ? 'לא ידוע' : x.toLocaleString('en-US'));

export type PreviewResult = { ok: true; preview: Preview } | { ok: false; errors_he: string[] };

export function previewCorrection(deal: ProcessedDeal, c: Correction, trace_id?: string): PreviewResult {
  const errors = validateCorrection(deal, c);
  if (errors.length) return { ok: false, errors_he: errors };

  const after = applyCorrection(deal, c);
  const ds = loadDataset();
  const afterDeals = ds.deals.map((d) => (d.deal_id === deal.deal_id ? after : d));
  const mBefore = marketContext(deal);
  const mAfter = marketContext(after, {}, { deals: afterDeals, latest_deal_date: ds.summary.latest_deal_date });

  const vField = fieldInfo[c.field].verdictField;
  const vb = verifyClaim(deal, vField);
  const va = verifyClaim(after, vField);

  const lines: string[] = [];
  if (deal.status !== after.status) lines.push(`סטטוס העסקה: ${statusHe[deal.status]} ← ${statusHe[after.status]}`);
  if (deal.price_nis !== after.price_nis) lines.push(`מחיר שמוצג: ₪${n(deal.price_nis)} ← ₪${n(after.price_nis)}`);
  if (deal.calculated_ppsm !== after.calculated_ppsm) lines.push(`מחיר למ"ר מחושב: ₪${n(deal.calculated_ppsm)} ← ₪${n(after.calculated_ppsm)}`);
  if (deal.include_in_stats !== after.include_in_stats) {
    lines.push(after.include_in_stats ? 'העסקה תיכנס לחישובי השוק' : 'העסקה תצא מחישובי השוק');
  }
  for (const f of after.flags.filter((x) => !deal.flags.includes(x))) lines.push(`סימון חדש: ${flagLabel[f] ?? f}`);
  for (const f of deal.flags.filter((x) => !after.flags.includes(x))) lines.push(`סימון שיוסר: ${flagLabel[f] ?? f}`);
  if (vb.verdict !== va.verdict) lines.push(`תוצאת הבדיקה לשדה "${fieldInfo[c.field].he}": ${verdictLabel[vb.verdict]} ← ${verdictLabel[va.verdict]}`);
  if (mBefore.n !== mAfter.n) lines.push(`מספר העסקאות בהקשר השוק: ${mBefore.n} ← ${mAfter.n}`);
  if (mBefore.stats && mAfter.stats && mBefore.stats.median_price !== mAfter.stats.median_price) {
    lines.push(`מחיר חציוני בהקשר השוק: ₪${n(mBefore.stats.median_price)} ← ₪${n(mAfter.stats.median_price)}`);
  }
  if (!lines.length) lines.push('התיקון אינו משנה את הסטטוס, הסימונים או תוצאת הבדיקה של העסקה.');

  const notes = ['סימון "מחיר למ"ר חריג" מחושב על כל הקובץ ונבחן רק בהרצת הצנרת המלאה (scripts/apply_corrections.py), לא בתצוגה מקדימה זו.'];
  if (after.flags.includes('PPSM_MISMATCH')) {
    notes.push('גם אחרי התיקון, המחיר למ"ר שנרשם בקובץ עדיין אינו תואם למחיר חלקי שטח. ייתכן שנדרש תיקון נוסף באותה שורה (למשל של המחיר למ"ר).');
  }
  const old = currentValue(deal.raw_rows.find((r) => r.row_index === c.row_index)!, c.field);
  return {
    ok: true,
    preview: {
      csv_line: csvLine(c),
      old_value: old,
      before: snap(deal),
      after: snap(after),
      verdict: { field: vField, before: vb.verdict, after: va.verdict, before_facts_he: vb.facts_he, after_facts_he: va.facts_he },
      market: { before: mBefore, after: mAfter },
      change_lines_he: lines,
      notes_he: notes,
      request_text: requestText(deal, c, lines, trace_id),
      json_entry: jsonEntry(c, old),
      csv_patch_he: `שורה ${csvLine(c)}, עמודה ${fieldInfo[c.field].column}: ${old ?? '(ריק)'} ← ${c.new_value}`,
    },
  };
}

// ---------- approved corrections (applied to the v2 copy only) ----------

const ApprovedSchema = z.object({
  corrections: z.array(CorrectionSchema.extend({
    old_value: z.number().int().nullable(),
    approved_by: z.string().nullable(),
    approved_at: z.string().nullable(),
  })),
});
export type ApprovedCorrection = z.infer<typeof ApprovedSchema>['corrections'][number];

export function loadApproved(): ApprovedCorrection[] {
  const file = path.join(process.cwd(), 'data', 'corrections.approved.json');
  if (!existsSync(file)) return [];
  return ApprovedSchema.parse(JSON.parse(readFileSync(file, 'utf-8'))).corrections;
}
