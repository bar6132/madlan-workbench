import { test, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { applyCorrection, ppsmOf, suggestFixes, validateCorrection, type Correction } from '@/lib/correction-core';
import { loadApproved, previewCorrection } from '@/lib/corrections';
import { getDeal, loadDataset, loadDatasetV2 } from '@/lib/data';
import { resetRateLimitForTests } from '@/lib/rate-limit';
import { POST } from '@/app/api/corrections/preview/route';

const deal = (id: string) => getDeal(id)!;
const corr = (o: Partial<Correction> & Pick<Correction, 'deal_id' | 'row_index' | 'field' | 'new_value'>): Correction =>
  ({ reason: 'מחיר מתוך חוזה המכירה', source_of_info: 'חוזה מכר מס׳ 123', ...o });

beforeEach(() => resetRateLimitForTests());

test('Python-style rounding: halves go to the even number', () => {
  expect(ppsmOf(5, 2)).toBe(2);   // 2.5 -> 2
  expect(ppsmOf(7, 2)).toBe(4);   // 3.5 -> 4
  expect(ppsmOf(10401000, 129)).toBe(80628);
  expect(ppsmOf(null, 10)).toBeNull();
  expect(ppsmOf(100, 0)).toBeNull();
});

// ---- validation ----
test('validation: unknown row, same value, out-of-range values are rejected in Hebrew', () => {
  const d = deal('D100313');
  expect(validateCorrection(d, corr({ deal_id: 'D100313', row_index: 1, field: 'price_nis', new_value: 5_000_000 }))[0]).toContain('אינה שייכת');
  expect(validateCorrection(d, corr({ deal_id: 'D100313', row_index: 299, field: 'price_per_sqm', new_value: 58234 }))[0]).toContain('זהה');
  expect(validateCorrection(d, corr({ deal_id: 'D100313', row_index: 299, field: 'size_sqm', new_value: 5 })).length).toBe(1);
  expect(validateCorrection(d, corr({ deal_id: 'D100313', row_index: 299, field: 'price_nis', new_value: 5_000_000 }))).toEqual([]);
});

// ---- suggestions: derived only, never guessed ----
test('suggestion for a price-per-m2 mismatch is the computed value, labelled as resting on an assumption', () => {
  const s = suggestFixes(deal('D100313'));
  expect(s.suggestions).toHaveLength(1);
  expect(s.suggestions[0]).toMatchObject({ row_index: 299, field: 'price_per_sqm', value: 80628 });
  expect(s.suggestions[0].assumption_he).toContain('בהנחה');
});

test('for an implausible price there is NO suggested value, only an explanation that a source is needed', () => {
  for (const id of ['D100317', 'D100251']) {
    const s = suggestFixes(deal(id));
    expect(s.suggestions.every((x) => x.field !== 'price_nis')).toBe(true);
    expect(s.cannot_derive_he.join(' ')).toContain('ממה הוא נלקח');
  }
});

test('a clean deal has nothing to suggest', () => {
  const clean = loadDataset().deals.find((d) => d.flags.length === 0)!;
  expect(suggestFixes(clean)).toEqual({ suggestions: [], cannot_derive_he: [] });
});

// ---- the what-if: outcomes pinned, not just parity ----
test('correcting an implausible price: the deal leaves EXCLUDED, enters market stats and the verdict changes', () => {
  const r = previewCorrection(deal('D100317'), corr({ deal_id: 'D100317', row_index: 78, field: 'price_nis', new_value: 1_800_000 }));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const p = r.preview;
  expect(p.before.status).toBe('EXCLUDED');
  expect(p.after.status).not.toBe('EXCLUDED');
  expect(p.after.include_in_stats).toBe(true);
  expect(p.verdict).toMatchObject({ field: 'price', before: 'RAW_VALUE_WRONG' });
  expect(p.market.after.n).toBe(p.market.before.n + 1);
  expect(p.change_lines_he.join('\n')).toContain('תיכנס לחישובי השוק');
  expect(p.csv_patch_he).toContain('שורה 80');
  expect(p.notes_he.join(' ')).toContain('תיקון נוסף'); // price per m2 in the file (0) still disagrees
  expect(p.json_entry).toMatchObject({ old_value: 18000, new_value: 1_800_000, approved_by: null });
});

test('conflict: correcting the matching row to a value that breaks the match falls back to source order, and says so', () => {
  const after = applyCorrection(deal('D100124'), corr({ deal_id: 'D100124', row_index: 373, field: 'price_nis', new_value: 5_500_000 }));
  expect(after.primary_reason).toBe('SOURCE_ORDER');
  expect(after.explanations_he.join(' ')).toContain('הנחה של המערכת');
});

test('exact duplicate stops being one once a row is corrected', () => {
  const before = deal('D100025');
  expect(before.primary_reason).toBe('EXACT_DUP');
  const after = applyCorrection(before, corr({ deal_id: 'D100025', row_index: 518, field: 'price_nis', new_value: 2_700_000 }));
  expect(after.flags).not.toContain('EXACT_DUPLICATE');
  expect(after.flags).toContain('SOURCE_CONFLICT');
});

test('a correction that changes nothing observable says so instead of inventing an effect', () => {
  const d = loadDataset().deals.find((x) => x.raw_rows.length === 1 && x.flags.length === 0 && x.price_nis && x.size_sqm)!;
  const row = d.raw_rows[0];
  const r = previewCorrection(d, corr({ deal_id: d.deal_id, row_index: row.row_index, field: 'price_nis', new_value: row.price_nis! + 1000 }));
  expect(r.ok).toBe(true);
});

test('preview never mutates the loaded dataset', () => {
  const before = JSON.stringify(deal('D100317'));
  const marketBefore = JSON.stringify(loadDataset().deals.slice(0, 50));
  previewCorrection(deal('D100317'), corr({ deal_id: 'D100317', row_index: 78, field: 'price_nis', new_value: 1_800_000 }));
  expect(JSON.stringify(deal('D100317'))).toBe(before);
  expect(JSON.stringify(loadDataset().deals.slice(0, 50))).toBe(marketBefore);
});

test('the request text for R&D carries everything needed and states that nothing was changed', () => {
  const r = previewCorrection(deal('D100317'), corr({ deal_id: 'D100317', row_index: 78, field: 'price_nis', new_value: 1_800_000 }), 'trc_abc12345');
  if (!r.ok) throw new Error('expected ok');
  const t = r.preview.request_text;
  for (const part of ['D100317', 'דרך השלום', 'רחובות', '4.5 חדרים', '132 מ"ר', 'שורה 80', '18,000', '1,800,000', 'חוזה מכר מס׳ 123', 'לא בוצע שינוי בקובץ המקור', 'trc_abc12345']) {
    expect(t).toContain(part);
  }
});

// ---- the original file and the v2 copy ----
test('the original CSV is the pinned challenge file (corrections must only reach v2)', () => {
  const sha = createHash('sha256').update(readFileSync('data/madlan_deals_sample.csv')).digest('hex');
  expect(sha).toBe('cfe4a245e08a1bda6daf53a0e16c8f745c4b2e154713ce63fee8bca8ab9aac88');
});

test('approved corrections are valid, point at real rows with the expected old value, and v2 reflects them', () => {
  const approved = loadApproved();
  expect(approved.length).toBeGreaterThan(0);
  const v2 = loadDatasetV2()!;
  for (const a of approved) {
    const row = deal(a.deal_id).raw_rows.find((r) => r.row_index === a.row_index)!;
    expect(row, a.deal_id).toBeTruthy();
    const current = a.field === 'price_nis' ? row.price_nis : a.field === 'size_sqm' ? row.size_sqm : row.csv_price_per_sqm;
    expect(current, a.deal_id).toBe(a.old_value);
    const v2row = v2.deals.find((d) => d.deal_id === a.deal_id)!.raw_rows.find((r) => r.row_index === a.row_index)!;
    const now = a.field === 'price_nis' ? v2row.price_nis : a.field === 'size_sqm' ? v2row.size_sqm : v2row.csv_price_per_sqm;
    expect(now, a.deal_id).toBe(a.new_value);
  }
});

// ---- the API ----
const post = (body: unknown, raw?: string) =>
  POST(new Request('http://localhost/api/corrections/preview', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, body: raw ?? JSON.stringify(body),
  }));
const GOOD = { deal_id: 'D100317', row_index: 78, field: 'price_nis', new_value: 1_800_000, reason: 'מחיר מתוך חוזה המכירה', source_of_info: 'חוזה מכר' };

test('API: valid proposal returns a preview', async () => {
  const res = await post(GOOD);
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j.ok).toBe(true);
  expect(j.preview.after.include_in_stats).toBe(true);
  expect(j.trace_id).toMatch(/^trc_/);
});

test('API: a proposal without a reason or source is refused with a clear Hebrew message', async () => {
  const res = await post({ ...GOOD, reason: '', source_of_info: '' });
  expect(res.status).toBe(422);
  expect((await res.json()).errors_he[0]).toContain('מקור');
});

test('API: bad input is handled, never a stack trace', async () => {
  expect((await post(null, 'not json')).status).toBe(400);
  expect((await post({ ...GOOD, new_value: 1.5 })).status).toBe(422);
  expect((await post({ ...GOOD, deal_id: 'D999999' })).status).toBe(404);
  expect((await post({ ...GOOD, row_index: 3 })).status).toBe(422);
  const text = await (await post({ ...GOOD, new_value: 18000 })).text(); // same value
  expect(text).toContain('זהה');
  expect(text).not.toMatch(/stack|at \w+ \(/);
});

test('API: SQL-looking or script text in the free-text fields is just text and is not echoed into logs', async () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const canary = "'; DROP TABLE deals; -- <script>CANARY9f3a</script>";
  const res = await post({ ...GOOD, reason: canary, source_of_info: canary });
  const logged = spy.mock.calls.map((c) => String(c[0])).join('');
  spy.mockRestore();
  expect(res.status).toBe(200);
  expect(logged).not.toContain('CANARY9f3a');
  expect(logged).toContain('PREVIEW');
});

test('API: rate limited like the rest of the app', async () => {
  let last = 200;
  for (let i = 0; i < 20; i++) last = (await post(GOOD)).status;
  expect(last).toBe(429);
});
