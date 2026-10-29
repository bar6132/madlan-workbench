import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDataset } from '@/lib/data';
import { applyCorrection, currentValue, type Correction } from '@/lib/correction-core';
import type { ProcessedDeal } from '@/lib/types';

// The what-if preview is a TypeScript port of the price-dependent rules in scripts/build_dataset.py.
// These tests make the real Python pipeline the judge, so the port cannot drift.

const deals = loadDataset().deals;
const byId = new Map(deals.map((d) => [d.deal_id, d]));

// PPSM_OUTLIER depends on the whole file, so it is excluded from the comparison (and from the preview).
function comparable(d: ProcessedDeal) {
  const keep = d.flags.map((f, i) => [f, d.explanations_he[i]] as const).filter(([f]) => f !== 'PPSM_OUTLIER');
  return {
    status: d.status, include_in_stats: d.include_in_stats, price_nis: d.price_nis, size_sqm: d.size_sqm,
    csv_price_per_sqm: d.csv_price_per_sqm, calculated_ppsm: d.calculated_ppsm, source: d.source,
    primary_row_index: d.primary_row_index, primary_reason: d.primary_reason, raw_rows: d.raw_rows,
    flags: keep.map(([f]) => f), explanations_he: keep.map(([, t]) => t),
  };
}

test('with no actual change, the port reproduces the pipeline output for every deal that has a price-per-m2 cell', () => {
  let checked = 0;
  for (const d of deals) {
    const row = d.raw_rows[0];
    if (row.csv_price_per_sqm === null) continue; // cannot express "unchanged" for an empty cell
    const same: Correction = {
      deal_id: d.deal_id, row_index: row.row_index, field: 'price_per_sqm', new_value: row.csv_price_per_sqm,
      reason: 'no-op', source_of_info: 'test',
    };
    expect(comparable(applyCorrection(d, same)), d.deal_id).toEqual(comparable(d));
    checked++;
  }
  expect(checked).toBeGreaterThan(450);
});

const mk = (field: Correction['field']) => (deal_id: string, row_index: number, new_value: number): Correction =>
  ({ deal_id, row_index, field, new_value, reason: 'parity test', source_of_info: 'parity test' });
const price = mk('price_nis');
const size = mk('size_sqm');
const ppsm = mk('price_per_sqm');

// Each inner array is one pipeline run (two corrections on the same deal are checked in separate runs).
const RUNS: Correction[][] = [
  [
    ppsm('D100313', 299, 80628),       // mismatch fixed
    price('D100317', 78, 1_800_000),   // excluded low price becomes a normal deal
    price('D100251', 331, 3_000_000),  // price 0 becomes a normal deal
    price('D100124', 373, 5_500_000),  // conflict: the matching row stops matching, falls back to source order
    price('D100025', 518, 2_700_000),  // exact duplicate becomes a conflict
    size('D100223', 38, 100),          // missing size filled
    size('D100032', 245, 90),          // conflict: a size change breaks the price-per-m2 match
  ],
  [price('D100124', 65, 5_727_000)],   // both rows now equal: tie broken by source order
];

test('the preview equals the real pipeline run on a corrected CSV', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'corr-'));
  RUNS.forEach((group, gi) => {
    const approved = group.map((c) => {
      const row = byId.get(c.deal_id)!.raw_rows.find((r) => r.row_index === c.row_index)!;
      return { ...c, old_value: currentValue(row, c.field), approved_by: null, approved_at: null };
    });
    const corr = path.join(tmp, `c${gi}.json`);
    const outCsv = path.join(tmp, `v${gi}.csv`);
    const outJson = path.join(tmp, `v${gi}.json`);
    writeFileSync(corr, JSON.stringify({ corrections: approved }));
    execFileSync('python', ['scripts/apply_corrections.py', '--corrections', corr, '--out-csv', outCsv, '--out-json', outJson], { stdio: 'pipe' });
    const v2 = new Map((JSON.parse(readFileSync(outJson, 'utf-8')).deals as ProcessedDeal[]).map((d) => [d.deal_id, d]));
    for (const c of group) {
      const preview = applyCorrection(byId.get(c.deal_id)!, c);
      expect(comparable(preview), `${c.deal_id} ${c.field}=${c.new_value}`).toEqual(comparable(v2.get(c.deal_id)!));
    }
  });
}, 120_000);
