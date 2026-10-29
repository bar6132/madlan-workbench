import { loadDataset, getDeal } from './data';
import type { ProcessedDeal } from './types';

export type Resolution =
  | { kind: 'FOUND'; deal: ProcessedDeal }
  | { kind: 'AMBIGUOUS'; candidates: ProcessedDeal[] }
  | { kind: 'NOT_FOUND' };

const ID_RE = /D((?:\s*\d){6})(?!\s*\d)/gi;
const MAX_CANDIDATES = 10;
const STATED_TOLERANCE = 0.01;

// Input aliases only; the canonical cleaning lives in scripts/build_dataset.py.
const CITY_ALIASES: Record<string, string> = {
  'תל אביב': 'תל אביב-יפו', 'תל אביב יפו': 'תל אביב-יפו', 'ת"א': 'תל אביב-יפו',
  'tel aviv': 'תל אביב-יפו', 'tel aviv-yafo': 'תל אביב-יפו',
  jerusalem: 'ירושלים', 'באר-שבע': 'באר שבע', 'ב"ש': 'באר שבע',
  'מודיעין': 'מודיעין-מכבים-רעות', 'מודיעין מכבים רעות': 'מודיעין-מכבים-רעות',
  'בית-שמש': 'בית שמש',
};

export function extractDealIds(text: string): string[] {
  const ids = [...text.matchAll(ID_RE)].map((m) => `D${m[1].replace(/\s/g, '')}`);
  return [...new Set(ids)];
}

export function normalizeDealId(input: string): string | null {
  return extractDealIds(input)[0] ?? null;
}

export function canonicalCity(input: string): string | null {
  const t = input.trim().replace(/[״“”]/g, '"');
  const known = new Set(loadDataset().deals.map((d) => d.city));
  if (known.has(t)) return t;
  const alias = CITY_ALIASES[t] ?? CITY_ALIASES[t.toLowerCase()];
  return alias && known.has(alias) ? alias : null;
}

const norm = (s: string) => s.replace(/[״“”']/g, '"').replace(/\s+/g, ' ').trim();

export function resolve(q: {
  deal_ids: string[];
  city?: string | null;
  neighborhood?: string | null;
  street?: string | null;
  stated_value?: number | null;
}): Resolution {
  const ids = [...new Set(q.deal_ids.map(normalizeDealId).filter((x): x is string => !!x))];
  if (ids.length) {
    const found = ids.map(getDeal).filter((d): d is ProcessedDeal => !!d);
    if (found.length === 0) return { kind: 'NOT_FOUND' };
    return found.length === 1 ? { kind: 'FOUND', deal: found[0] } : { kind: 'AMBIGUOUS', candidates: found };
  }
  if (!q.street && !q.neighborhood) return { kind: 'NOT_FOUND' };

  // An unrecognised city spelling is ignored rather than treated as "no such deal".
  const city = q.city ? canonicalCity(q.city) : null;
  const street = q.street ? norm(q.street) : null;
  const hood = q.neighborhood ? norm(q.neighborhood) : null;
  let cands = loadDataset().deals.filter((d) => {
    if (city && d.city !== city) return false;
    if (street && !(d.street && (norm(d.street).includes(street) || street.includes(norm(d.street))))) return false;
    if (hood && !(d.neighborhood && (norm(d.neighborhood).includes(hood) || hood.includes(norm(d.neighborhood))))) return false;
    return true;
  });
  if (q.stated_value && cands.length > 1) {
    const v = q.stated_value;
    const narrowed = cands.filter((d) =>
      d.raw_rows.some((r) => r.price_nis !== null && Math.abs(r.price_nis - v) / v <= STATED_TOLERANCE));
    if (narrowed.length) cands = narrowed;
  }
  if (cands.length === 0) return { kind: 'NOT_FOUND' };
  if (cands.length === 1) return { kind: 'FOUND', deal: cands[0] };
  cands.sort((a, b) => (b.deal_date ?? '').localeCompare(a.deal_date ?? ''));
  return { kind: 'AMBIGUOUS', candidates: cands.slice(0, MAX_CANDIDATES) };
}
