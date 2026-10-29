import { test, expect } from 'vitest';
import { loadDataset } from '@/lib/data';
import { PAGE_SIZE, buildFacets, parseExplorerParams, queryDeals, type RawParams } from '@/lib/explorer';

const deals = loadDataset().deals;
const run = (raw: RawParams) => queryDeals(deals, parseExplorerParams(raw));

test('no filters: every deal is browsable, newest first, paged', () => {
  const r = run({});
  expect(r.total).toBe(520);
  expect(r.pages).toBe(Math.ceil(520 / PAGE_SIZE));
  expect(r.items).toHaveLength(PAGE_SIZE);
  const dates = r.items.map((d) => d.deal_date).filter((x): x is string => !!x);
  expect([...dates].sort().reverse()).toEqual(dates);
});

test('text search finds a deal id however it is typed', () => {
  for (const q of ['D100124', 'd100124', ' d100 124 ']) {
    expect(run({ q }).items.map((d) => d.deal_id)).toEqual(['D100124']);
  }
});

test('text search matches street and city words, all tokens required', () => {
  const r = run({ q: 'בן גוריון חולון' });
  expect(r.total).toBeGreaterThan(0);
  expect(r.items.every((d) => d.city === 'חולון' && (d.street ?? '').includes('בן גוריון'))).toBe(true);
  expect(run({ q: 'בן גוריון חולון zzzz' }).total).toBe(0);
});

test('search treats regex characters as plain text', () => {
  expect(() => run({ q: '([*+?\\' })).not.toThrow();
  expect(run({ q: '([*+?\\' }).total).toBe(0);
});

test('city filter accepts aliases and quote variants', () => {
  const canonical = run({ city: 'תל אביב-יפו' }).total;
  expect(canonical).toBeGreaterThan(0);
  expect(run({ city: 'ת"א' }).total).toBe(canonical);
});

test('status and flag filters agree with independent counts', () => {
  expect(run({ status: 'EXCLUDED' }).total).toBe(2);
  expect(run({ status: 'CONFLICT' }).total).toBe(4);
  expect(run({ flag: 'PPSM_MISMATCH' }).total).toBe(deals.filter((d) => d.flags.includes('PPSM_MISMATCH')).length);
});

test('price range keeps only deals with a price inside it', () => {
  const r = run({ min_price: '3000000', max_price: '4000000', sort: 'price_asc' });
  expect(r.total).toBeGreaterThan(0);
  expect(r.items.every((d) => d.price_nis !== null && d.price_nis >= 3e6 && d.price_nis <= 4e6)).toBe(true);
});

test('price sort is monotonic and missing prices sort last', () => {
  const all = queryDeals(deals, { ...parseExplorerParams({ sort: 'price_asc' }), page: 1 });
  const prices = all.items.map((d) => d.price_nis);
  expect(prices.every((p) => p !== null)).toBe(true);
  expect([...prices].sort((a, b) => a! - b!)).toEqual(prices);
  const lastPage = run({ sort: 'price_desc', page: String(all.pages) });
  expect(lastPage.items.at(-1)?.price_nis ?? null).not.toBeNull();
});

test('page numbers clamp; paging never repeats or drops a deal', () => {
  const pages = run({}).pages;
  expect(run({ page: '999' }).page).toBe(pages);
  expect(run({ page: '-3' }).page).toBe(1);
  const seen = new Set<string>();
  for (let p = 1; p <= pages; p++) for (const d of run({ sort: 'id_asc', page: String(p) }).items) seen.add(d.deal_id);
  expect(seen.size).toBe(520);
});

test('garbage parameters fall back to defaults instead of throwing', () => {
  const p = parseExplorerParams({ min_price: 'abc', max_price: '-5', sort: 'drop table', page: 'x', q: ['a', 'b'] });
  expect(p).toMatchObject({ min_price: null, max_price: null, sort: 'date_desc', page: 1, q: 'a' });
});

test('facets cover every deal exactly once per dimension', () => {
  const f = buildFacets(deals);
  expect(f.cities).toHaveLength(18);
  expect(f.statuses.reduce((n, x) => n + x.count, 0)).toBe(520);
  expect(f.property_types.reduce((n, x) => n + x.count, 0)).toBe(520);
});
