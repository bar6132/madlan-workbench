import { test, expect } from 'vitest';
import { loadDataset, getDeal } from '@/lib/data';
import { verifyClaim } from '@/lib/verifier';

const deal = (id: string) => getDeal(id)!;
const BANNED_CAUSE_WORDS = /(^|\s)(שונה|זייף|זויף|הוחלף|שונתה)(\s|[.,]|$)/;

test('D100313 price_per_sqm is RAW_VALUE_WRONG with both numbers allowed', () => {
  const f = verifyClaim(deal('D100313'), 'price_per_sqm');
  expect(f.verdict).toBe('RAW_VALUE_WRONG');
  for (const n of [10401000, 129, 58234, 80628]) expect(f.allowed_numbers).toContain(n);
  expect(f.allowed_deal_ids).toEqual(['D100313']);
  expect(f.rule_ids).toContain('PPSM_MISMATCH');
});

test('zero and rent-like prices are RAW_VALUE_WRONG', () => {
  expect(verifyClaim(deal('D100251'), 'price').verdict).toBe('RAW_VALUE_WRONG');
  expect(verifyClaim(deal('D100317'), 'price').verdict).toBe('RAW_VALUE_WRONG');
});

test('D100124 two_prices is SOURCES_CONFLICT with primary vs other', () => {
  const f = verifyClaim(deal('D100124'), 'two_prices');
  expect(f.verdict).toBe('SOURCES_CONFLICT');
  expect(f.conflict?.primary).toEqual({ source: 'רשות המסים', price: 5727000 });
  expect(f.conflict?.other).toEqual({ source: 'מתווך', price: 5429440 });
  expect(f.conflict?.reason_he).toContain('המחיר למ"ר');
  expect(f.allowed_numbers).toEqual(expect.arrayContaining([5727000, 5429440]));
});

test('stated value matching the non-primary row is reported', () => {
  const f = verifyClaim(deal('D100124'), 'price', 5429440);
  expect(f.verdict).toBe('SOURCES_CONFLICT');
  expect(f.rule_ids).toContain('STATED_MATCHES_NONPRIMARY');
});

test('stated value matching neither row is called out and verdict is unchanged', () => {
  const f = verifyClaim(deal('D100124'), 'price', 1234567);
  expect(f.verdict).toBe('SOURCES_CONFLICT');
  expect(f.facts_he.join(' ')).toContain('הערך שצוין אינו מופיע בנתונים');
});

test('owner-vs-broker conflicts say there is no Tax Authority row', () => {
  for (const id of ['D100032', 'D100303']) {
    const f = verifyClaim(deal(id), 'two_prices');
    expect(f.verdict).toBe('SOURCES_CONFLICT');
    expect(f.conflict?.primary.source).toBe('בעל נכס');
    expect(f.facts_he.join(' ')).toContain('אין בקובץ רשומה של רשות המסים');
  }
});

test('a clean deal price complaint is RAW_VALUE_OK and does not judge fairness', () => {
  const clean = loadDataset().deals.find((d) => d.status === 'VALID' && d.flags.length === 0)!;
  const f = verifyClaim(clean, 'price');
  expect(f.verdict).toBe('RAW_VALUE_OK');
  expect(f.facts_he.join(' ')).toContain('אינם מאפשרים לקבוע אם המחיר סביר');
});

test('missing size, month-only date, and unsupported topics are CANNOT_DETERMINE', () => {
  expect(verifyClaim(deal('D100223'), 'size').verdict).toBe('CANNOT_DETERMINE');
  const monthOnly = loadDataset().deals.find((d) => d.date_precision === 'month')!;
  expect(verifyClaim(monthOnly, 'date').verdict).toBe('CANNOT_DETERMINE');
  const f = verifyClaim(deal('D100313'), 'other');
  expect(f.verdict).toBe('CANNOT_DETERMINE');
  expect(f.facts_he.join(' ')).toContain('אינו חלק מהנתונים');
});

test('present size and rooms are RAW_VALUE_OK', () => {
  expect(verifyClaim(deal('D100313'), 'size').verdict).toBe('RAW_VALUE_OK');
  expect(verifyClaim(deal('D100313'), 'rooms').verdict).toBe('RAW_VALUE_OK');
});

test('unknown deal is DEAL_NOT_FOUND', () => {
  const f = verifyClaim(undefined, 'price');
  expect(f.verdict).toBe('DEAL_NOT_FOUND');
  expect(f.deal_id).toBeNull();
});

test('no verdict text asserts a cause', () => {
  for (const d of loadDataset().deals.slice(0, 200)) {
    for (const field of ['price', 'price_per_sqm', 'two_prices', 'size', 'date', 'rooms', 'other'] as const) {
      expect(verifyClaim(d, field).facts_he.join(' ')).not.toMatch(BANNED_CAUSE_WORDS);
    }
  }
});
