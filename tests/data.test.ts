import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDataset, getDeal } from '@/lib/data';

test('dataset loads with 520 deals and a summary', () => {
  const ds = loadDataset();
  expect(ds.deals).toHaveLength(520);
  expect(ds.summary.raw_rows).toBe(530);
  expect(getDeal('D100124')?.price_nis).toBe(5727000);
  expect(getDeal('D999999')).toBeUndefined();
});

test('committed deals.processed.json is not stale versus a fresh pipeline run', () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'deals-')), 'fresh.json');
  execFileSync('python', ['-I', 'scripts/build_dataset.py', '--out', out], { stdio: 'pipe' });
  const fresh = JSON.parse(readFileSync(out, 'utf-8'));
  const committed = JSON.parse(readFileSync('data/deals.processed.json', 'utf-8'));
  expect(fresh).toEqual(committed);
});
