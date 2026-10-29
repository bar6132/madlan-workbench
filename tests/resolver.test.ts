import { test, expect } from 'vitest';
import { loadDataset } from '@/lib/data';
import { normalizeDealId, extractDealIds, canonicalCity, resolve } from '@/lib/resolver';

test('normalizeDealId handles case, spaces and surrounding text', () => {
  expect(normalizeDealId('d100124')).toBe('D100124');
  expect(normalizeDealId(' D100 124 ')).toBe('D100124');
  expect(normalizeDealId('שלום')).toBeNull();
  expect(normalizeDealId('בדקו את d100313 בבקשה')).toBe('D100313');
  expect(extractDealIds('D100124 ו-d100313 וגם D100124')).toEqual(['D100124', 'D100313']);
});

test('canonicalCity maps aliases and variants', () => {
  expect(canonicalCity('ת"א')).toBe('תל אביב-יפו');
  expect(canonicalCity('תל אביב')).toBe('תל אביב-יפו');
  expect(canonicalCity(' ירושלים ')).toBe('ירושלים');
  expect(canonicalCity('ב"ש')).toBe('באר שבע');
  expect(canonicalCity('מודיעין')).toBe('מודיעין-מכבים-רעות');
  expect(canonicalCity('Jerusalem')).toBe('ירושלים');
  expect(canonicalCity('חולון')).toBe('חולון');
  expect(canonicalCity('עיר שלא קיימת')).toBeNull();
});

test('resolve by id: found, not found, excluded still found', () => {
  const found = resolve({ deal_ids: ['D100124'] });
  expect(found.kind).toBe('FOUND');
  expect(resolve({ deal_ids: ['D100999'] }).kind).toBe('NOT_FOUND');
  const ex = resolve({ deal_ids: ['d100251'] });
  expect(ex.kind === 'FOUND' && ex.deal.status).toBe('EXCLUDED');
});

test('resolve by address returns AMBIGUOUS and never picks one', () => {
  const groups = new Map<string, string[]>();
  for (const d of loadDataset().deals) {
    if (!d.street) continue;
    const k = `${d.city}|${d.street}`;
    groups.set(k, [...(groups.get(k) ?? []), d.deal_id]);
  }
  const [key, ids] = [...groups.entries()].find(([, v]) => v.length >= 2)!;
  const [city, street] = key.split('|');
  const r = resolve({ deal_ids: [], city, street });
  expect(r.kind).toBe('AMBIGUOUS');
  if (r.kind === 'AMBIGUOUS') {
    expect(r.candidates.map((c) => c.deal_id).sort()).toEqual(expect.arrayContaining(ids.slice(0, 2)));
  }
});

test('a stated value narrows candidates to the matching deal', () => {
  const d = loadDataset().deals.find((x) => x.deal_id === 'D100313')!;
  const r = resolve({ deal_ids: [], city: d.city, street: d.street!, stated_value: 10401000 });
  expect(r.kind).toBe('FOUND');
  if (r.kind === 'FOUND') expect(r.deal.deal_id).toBe('D100313');
});

test('city alias resolves like canonical and too-broad queries are NOT_FOUND', () => {
  const d = loadDataset().deals.find((x) => x.city === 'תל אביב-יפו' && x.street)!;
  const a = resolve({ deal_ids: [], city: 'ת"א', street: d.street! });
  expect(a.kind === 'FOUND' || a.kind === 'AMBIGUOUS').toBe(true);
  expect(resolve({ deal_ids: [], city: 'חולון' }).kind).toBe('NOT_FOUND');
  expect(resolve({ deal_ids: [] }).kind).toBe('NOT_FOUND');
});
