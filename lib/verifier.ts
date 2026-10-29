import type { ProcessedDeal, RawRow } from './types';
import { he } from './copy';

export type Field = 'price' | 'price_per_sqm' | 'size' | 'date' | 'rooms' | 'two_prices' | 'other';
export type Verdict =
  | 'RAW_VALUE_WRONG' | 'RAW_VALUE_OK' | 'SOURCES_CONFLICT' | 'CANNOT_DETERMINE' | 'DEAL_NOT_FOUND';

export interface VerifiedFacts {
  verdict: Verdict;
  field: Field;
  deal_id: string | null;
  rule_ids: string[];
  facts_he: string[];
  allowed_numbers: number[];
  allowed_deal_ids: string[];
  rows: RawRow[];
  conflict?: {
    primary: { source: string; price: number };
    other: { source: string; price: number };
    reason_he: string;
  };
}

const TOLERANCE = 0.01;
const near = (a: number, b: number) => Math.abs(a - b) / b <= TOLERANCE;

function numbersIn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((t) => Number(t.replace(/,/g, '')))
    .filter((n) => !Number.isNaN(n));
}

function explanation(deal: ProcessedDeal, flag: string): string[] {
  const i = deal.flags.indexOf(flag);
  return i >= 0 ? [deal.explanations_he[i]] : [];
}

function finish(
  deal: ProcessedDeal | undefined,
  field: Field,
  verdict: Verdict,
  rule_ids: string[],
  facts_he: string[],
  conflict?: VerifiedFacts['conflict'],
): VerifiedFacts {
  const dealNums = deal
    ? [
        deal.size_sqm, deal.rooms, deal.floor, deal.year_built, deal.price_nis,
        deal.csv_price_per_sqm, deal.calculated_ppsm,
        ...deal.raw_rows.flatMap((r) => [r.price_nis, r.csv_price_per_sqm]),
      ]
    : [];
  const allowed = [
    ...new Set([
      ...dealNums.filter((n): n is number => typeof n === 'number'),
      ...facts_he.flatMap(numbersIn),
    ]),
  ];
  return {
    verdict, field, deal_id: deal?.deal_id ?? null, rule_ids, facts_he,
    allowed_numbers: allowed, allowed_deal_ids: deal ? [deal.deal_id] : [],
    rows: deal?.raw_rows ?? [], ...(conflict ? { conflict } : {}),
  };
}

function conflictFacts(deal: ProcessedDeal, field: Field, stated?: number | null): VerifiedFacts {
  const p = deal.raw_rows[deal.primary_row_index];
  const o = deal.raw_rows.find((_, i) => i !== deal.primary_row_index)!;
  const rules = ['SOURCE_CONFLICT'];
  const facts = [...explanation(deal, 'SOURCE_CONFLICT')];
  if (!deal.raw_rows.some((r) => r.source === 'רשות המסים')) facts.push(he.noTaxRow(p.source, o.source));
  if (stated) {
    const matchesOther = o.price_nis !== null && near(o.price_nis, stated);
    const matchesPrimary = p.price_nis !== null && near(p.price_nis, stated);
    if (matchesOther && !matchesPrimary) rules.push('STATED_MATCHES_NONPRIMARY');
    else if (matchesPrimary) facts.push(he.statedMatchesPrimary);
    else facts.push(he.statedNotInData);
  }
  return finish(deal, field, 'SOURCES_CONFLICT', rules, facts, {
    primary: { source: p.source, price: p.price_nis! },
    other: { source: o.source, price: o.price_nis! },
    reason_he: deal.primary_reason === 'PPSM_MATCH' ? he.conflictReasonPpsm : he.conflictReasonOrder,
  });
}

export function verifyClaim(
  deal: ProcessedDeal | undefined,
  field: Field,
  stated?: number | null,
): VerifiedFacts {
  if (!deal) return finish(undefined, field, 'DEAL_NOT_FOUND', ['DEAL_NOT_FOUND'], [he.dealNotFound]);

  const priceBad = ['PRICE_INVALID', 'PRICE_BELOW_THRESHOLD'].filter((f) => deal.flags.includes(f));
  const badFacts = priceBad.flatMap((f) => explanation(deal, f));

  switch (field) {
    case 'price':
    case 'two_prices': {
      if (deal.flags.includes('SOURCE_CONFLICT')) return conflictFacts(deal, field, stated);
      if (priceBad.length) return finish(deal, field, 'RAW_VALUE_WRONG', priceBad, badFacts);
      const facts: string[] = [];
      if (field === 'two_prices') facts.push(deal.flags.includes('EXACT_DUPLICATE') ? he.exactDup : he.singleReport);
      else facts.push(he.priceOk);
      if (stated) {
        const hit = deal.price_nis !== null && near(deal.price_nis, stated);
        facts.push(hit ? he.statedMatchesPrimary : he.statedNotInData);
      }
      return finish(deal, field, 'RAW_VALUE_OK', ['PRICE_CONSISTENT'], facts);
    }
    case 'price_per_sqm': {
      if (deal.flags.includes('SOURCE_CONFLICT')) return conflictFacts(deal, field, stated);
      if (priceBad.length) return finish(deal, field, 'RAW_VALUE_WRONG', priceBad, badFacts);
      if (deal.calculated_ppsm === null) {
        return finish(deal, field, 'CANNOT_DETERMINE', ['MISSING_SIZE'], [he.ppsmNoSize]);
      }
      if (deal.flags.includes('PPSM_MISMATCH')) {
        return finish(deal, field, 'RAW_VALUE_WRONG', ['PPSM_MISMATCH'], explanation(deal, 'PPSM_MISMATCH'));
      }
      return finish(deal, field, 'RAW_VALUE_OK', ['PPSM_CONSISTENT'], [he.ppsmOk(deal.calculated_ppsm)]);
    }
    case 'size':
      return deal.size_sqm === null
        ? finish(deal, field, 'CANNOT_DETERMINE', ['MISSING_SIZE'], [he.sizeMissing])
        : finish(deal, field, 'RAW_VALUE_OK', ['SIZE_PRESENT'], [he.sizeOk(deal.size_sqm)]);
    case 'date':
      if (!deal.deal_date) return finish(deal, field, 'CANNOT_DETERMINE', ['MISSING_DATE'], [he.dateMissing]);
      if (deal.date_precision === 'month') {
        const raw = deal.raw_rows[deal.primary_row_index].deal_date_raw;
        return finish(deal, field, 'CANNOT_DETERMINE', ['MONTH_ONLY_DATE'], [he.dateMonthOnly(raw)]);
      }
      return finish(deal, field, 'RAW_VALUE_OK', ['DATE_PRESENT'], [he.dateOk(deal.deal_date)]);
    case 'rooms':
      return deal.rooms === null
        ? finish(deal, field, 'CANNOT_DETERMINE', ['MISSING_ROOMS'], [he.roomsMissing])
        : finish(deal, field, 'RAW_VALUE_OK', ['ROOMS_PRESENT'], [he.roomsOk(deal.rooms)]);
    default:
      return finish(deal, field, 'CANNOT_DETERMINE', ['FIELD_NOT_IN_DATA'], [he.other]);
  }
}
