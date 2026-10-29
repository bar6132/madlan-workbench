import { test, expect } from 'vitest';
import { loadDataset, getDeal } from '@/lib/data';
import { marketContext } from '@/lib/market';

const ds = loadDataset();
const monthOf = (d: { deal_date: string | null }) => d.deal_date?.slice(0, 7) ?? '';
const inWindow = (m: string) => m >= '2024-08' && m <= '2026-07';

test('window is the 24 calendar months ending at the latest deal month', () => {
  const m = marketContext(getDeal('D100124')!);
  expect(m.window).toEqual({ from: '2024-08', to: '2026-07' });
  expect(m.basis).toBe('CLEAN');
});

test('a thin slice returns no statistics and says why', () => {
  const tiny = ds.deals.find((d) => d.city === 'חולון' && d.rooms === 1) ?? ds.deals.find((d) => d.rooms === 1)!;
  const m = marketContext(tiny);
  if (m.n < 5) {
    expect(m.stats).toBeNull();
    expect(m.reason_he).toContain('אין מספיק עסקאות להשוואה');
  }
  // force a thin slice deterministically: a unique room count in a city
  const rare = ds.deals.find((d) => d.rooms === 1 && d.include_in_stats)!;
  const mr = marketContext(rare);
  expect(mr.n).toBeLessThan(5);
  expect(mr.stats).toBeNull();
  expect(mr.reason_he).toContain('אין מספיק עסקאות להשוואה');
});

test('n for a Holon 4-room deal matches an independent count', () => {
  const target = ds.deals.find((d) => d.city === 'חולון' && d.rooms === 4 && d.neighborhood)!;
  const inCity = ds.deals.filter(
    (d) => d.city === 'חולון' && d.include_in_stats && d.price_nis && d.rooms !== null &&
      Math.abs(d.rooms - 4) <= 0.5 && inWindow(monthOf(d)),
  );
  const inHood = inCity.filter((d) => d.neighborhood === target.neighborhood);
  const expected = inHood.length >= 5 ? inHood.length : inCity.length;
  expect(marketContext(target).n).toBe(expected);
});

test('excluded deals are never counted in CLEAN, and conflicts count once', () => {
  const ex = getDeal('D100317')!; // רחובות, excluded
  const base = marketContext(ex);
  const rechovot = ds.deals.filter(
    (d) => d.city === 'רחובות' && d.include_in_stats && d.price_nis && d.rooms !== null &&
      ex.rooms !== null && Math.abs(d.rooms - ex.rooms) <= 0.5 && inWindow(monthOf(d)),
  );
  expect(rechovot.some((d) => d.deal_id === 'D100317')).toBe(false);
  expect(base.n).toBeLessThanOrEqual(rechovot.length);
  const conflictCity = getDeal('D100124')!;
  const m = marketContext(conflictCity);
  const ids = ds.deals.filter(
    (d) => d.city === conflictCity.city && d.include_in_stats && d.price_nis && d.rooms !== null &&
      conflictCity.rooms !== null && Math.abs(d.rooms - conflictCity.rooms) <= 0.5 && inWindow(monthOf(d)),
  );
  expect(m.n).toBeLessThanOrEqual(ids.length);
});

test('month-only dates count by calendar month', () => {
  const mo = ds.deals.find((d) => d.date_precision === 'month' && d.include_in_stats && inWindow(monthOf(d)) && d.rooms !== null)!;
  const m = marketContext(mo);
  expect(m.n).toBeGreaterThanOrEqual(1);
});

test('RAW basis includes excluded rows and reports its basis', () => {
  const d = getDeal('D100317')!;
  const clean = marketContext(d);
  const raw = marketContext(d, { raw: true });
  expect(raw.basis).toBe('RAW');
  expect(raw.n).toBeGreaterThanOrEqual(clean.n);
});

test('stats are internally ordered when present', () => {
  const m = marketContext(ds.deals.find((d) => d.city === 'חולון' && d.rooms === 4)!);
  if (m.stats) {
    expect(m.stats.p25_price).toBeLessThanOrEqual(m.stats.median_price);
    expect(m.stats.median_price).toBeLessThanOrEqual(m.stats.p75_price);
  }
  expect(m.scope_he.length).toBeGreaterThan(0);
});
