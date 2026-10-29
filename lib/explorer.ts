// Read-only query layer over the processed dataset for the deals browser. Pure functions, no I/O.
import { z } from 'zod';
import { canonicalCity } from './resolver';
import type { ProcessedDeal } from './types';

export const PAGE_SIZE = 20;
export const SORTS = ['date_desc', 'price_asc', 'price_desc', 'ppsm_desc', 'id_asc'] as const;
export type SortKey = (typeof SORTS)[number];

export interface ExplorerParams {
  q: string;
  city: string;
  status: string;
  property_type: string;
  flag: string;
  source: string;
  min_price: number | null;
  max_price: number | null;
  sort: SortKey;
  page: number;
}

export type RawParams = Record<string, string | string[] | undefined>;

const num = z.coerce.number().finite().nonnegative().max(1e10);

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 100) ?? '';
}

/** Never throws: unparseable values fall back to "no filter" so a hand-edited URL still renders. */
export function parseExplorerParams(raw: RawParams): ExplorerParams {
  const price = (k: string) => {
    const s = first(raw[k]);
    const r = s ? num.safeParse(s) : null;
    return r?.success ? r.data : null;
  };
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    q: first(raw.q),
    city: first(raw.city),
    status: first(raw.status),
    property_type: first(raw.property_type),
    flag: first(raw.flag),
    source: first(raw.source),
    min_price: price('min_price'),
    max_price: price('max_price'),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as SortKey) : 'date_desc',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Lowercase, drop quotes and hyphens so `ת"א`, `בית-שמש` and `בית שמש` compare equal. */
function norm(s: string): string {
  return s.toLowerCase().replace(/["'״׳`\-–]/g, ' ').replace(/\s+/g, ' ').trim();
}

function haystack(d: ProcessedDeal): string {
  return norm(
    [d.deal_id, d.city, d.raw_city, d.neighborhood, d.street, d.property_type, d.condition, d.source]
      .filter(Boolean)
      .join(' '),
  );
}

export function matchesText(d: ProcessedDeal, q: string): boolean {
  const tokens = norm(q).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const h = haystack(d);
  return tokens.every((t) => h.includes(t));
}

function matches(d: ProcessedDeal, p: ExplorerParams): boolean {
  if (p.q && !matchesText(d, p.q)) return false;
  if (p.city && d.city !== (canonicalCity(p.city) ?? p.city)) return false;
  if (p.status && d.status !== p.status) return false;
  if (p.property_type && d.property_type !== p.property_type) return false;
  if (p.flag && !d.flags.includes(p.flag)) return false;
  if (p.source && !d.raw_rows.some((r) => r.source === p.source)) return false;
  if (p.min_price !== null && (d.price_nis === null || d.price_nis < p.min_price)) return false;
  if (p.max_price !== null && (d.price_nis === null || d.price_nis > p.max_price)) return false;
  return true;
}

// Missing values always sort last, in either direction.
function byNullable(get: (d: ProcessedDeal) => number | string | null, dir: 1 | -1) {
  return (a: ProcessedDeal, b: ProcessedDeal) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return a.deal_id.localeCompare(b.deal_id);
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -dir : x > y ? dir : a.deal_id.localeCompare(b.deal_id);
  };
}

const SORTERS: Record<SortKey, (a: ProcessedDeal, b: ProcessedDeal) => number> = {
  date_desc: byNullable((d) => d.deal_date, -1),
  price_asc: byNullable((d) => d.price_nis, 1),
  price_desc: byNullable((d) => d.price_nis, -1),
  ppsm_desc: byNullable((d) => d.calculated_ppsm, -1),
  id_asc: (a, b) => a.deal_id.localeCompare(b.deal_id),
};

export interface DealSummary {
  deal_id: string;
  status: ProcessedDeal['status'];
  city: string;
  neighborhood: string | null;
  street: string | null;
  property_type: string;
  rooms: number | null;
  size_sqm: number | null;
  price_nis: number | null;
  calculated_ppsm: number | null;
  deal_date: string | null;
  flags: string[];
}

export function toSummary(d: ProcessedDeal): DealSummary {
  return {
    deal_id: d.deal_id, status: d.status, city: d.city, neighborhood: d.neighborhood, street: d.street,
    property_type: d.property_type, rooms: d.rooms, size_sqm: d.size_sqm, price_nis: d.price_nis,
    calculated_ppsm: d.calculated_ppsm, deal_date: d.deal_date, flags: d.flags,
  };
}

export interface Facet { value: string; count: number }
export interface Facets { cities: Facet[]; property_types: Facet[]; statuses: Facet[]; flags: Facet[]; sources: Facet[] }

function count(values: Iterable<string>): Facet[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'he'));
}

export function buildFacets(deals: ProcessedDeal[]): Facets {
  return {
    cities: count(deals.map((d) => d.city)).sort((a, b) => a.value.localeCompare(b.value, 'he')),
    property_types: count(deals.map((d) => d.property_type)),
    statuses: count(deals.map((d) => d.status)),
    flags: count(deals.flatMap((d) => d.flags)),
    sources: count(deals.flatMap((d) => [...new Set(d.raw_rows.map((r) => r.source))])),
  };
}

export interface ExplorerResult {
  total: number;
  page: number;
  pages: number;
  items: ProcessedDeal[];
}

export function queryDeals(deals: ProcessedDeal[], p: ExplorerParams): ExplorerResult {
  const hit = deals.filter((d) => matches(d, p)).sort(SORTERS[p.sort]);
  const pages = Math.max(1, Math.ceil(hit.length / PAGE_SIZE));
  const page = Math.min(p.page, pages);
  return { total: hit.length, page, pages, items: hit.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}
