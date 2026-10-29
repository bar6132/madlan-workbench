import { loadDataset } from './data';
import type { ProcessedDeal } from './types';

export interface MarketContext {
  scope_he: string;
  window: { from: string; to: string };
  n: number;
  stats: { median_price: number; median_ppsm: number; p25_price: number; p75_price: number } | null;
  reason_he?: string;
  basis: 'CLEAN' | 'RAW';
}

const WINDOW_MONTHS = 24;
const MIN_N = 5;
const ROOMS_TOLERANCE = 0.5;

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

interface Point { price: number; ppsm: number | null }

function points(deals: ProcessedDeal[], raw: boolean): Point[] {
  if (!raw) {
    return deals
      .filter((d) => d.include_in_stats && d.price_nis)
      .map((d) => ({ price: d.price_nis!, ppsm: d.calculated_ppsm }));
  }
  // Illustration only: every raw row exactly as the file states it.
  return deals.flatMap((d) =>
    d.raw_rows
      .filter((r) => r.price_nis !== null)
      .map((r) => ({ price: r.price_nis!, ppsm: r.csv_price_per_sqm })),
  );
}

export function marketContext(deal: ProcessedDeal, opts: { raw?: boolean } = {}): MarketContext {
  const raw = opts.raw ?? false;
  const to = loadDataset().summary.latest_deal_date.slice(0, 7);
  const from = shiftMonth(to, -(WINDOW_MONTHS - 1));
  const window = { from, to };

  const base = loadDataset().deals.filter((d) => {
    if (d.city !== deal.city || !d.deal_date) return false;
    const month = d.deal_date.slice(0, 7);
    if (month < from || month > to) return false;
    if (deal.rooms !== null && (d.rooms === null || Math.abs(d.rooms - deal.rooms) > ROOMS_TOLERANCE)) return false;
    return true;
  });
  const roomsHe = deal.rooms !== null ? `, ${deal.rooms} חדרים (±0.5)` : '';

  let scope = base;
  let scope_he = `${deal.city}${roomsHe}`;
  if (deal.neighborhood) {
    const hood = base.filter((d) => d.neighborhood === deal.neighborhood);
    if (points(hood, raw).length >= MIN_N) {
      scope = hood;
      scope_he = `${deal.city}, ${deal.neighborhood}${roomsHe}`;
    }
  }

  const pts = points(scope, raw);
  const basis = raw ? 'RAW' : 'CLEAN';
  const n = pts.length;
  if (n < MIN_N) {
    return { scope_he, window, n, stats: null, basis, reason_he: 'אין מספיק עסקאות להשוואה בחתך הזה ובתקופה שנבדקה.' };
  }
  const prices = pts.map((p) => p.price).sort((a, b) => a - b);
  const ppsms = pts.map((p) => p.ppsm).filter((x): x is number => typeof x === 'number' && x > 0);
  return {
    scope_he, window, n, basis,
    stats: {
      median_price: Math.round(median(prices)),
      median_ppsm: ppsms.length ? Math.round(median(ppsms)) : 0,
      p25_price: Math.round(quantile(prices, 0.25)),
      p75_price: Math.round(quantile(prices, 0.75)),
    },
  };
}
