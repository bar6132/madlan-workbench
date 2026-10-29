import { test, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { loadDataset, getDeal } from '@/lib/data';
import { verifyClaim } from '@/lib/verifier';
import { guardReply } from '@/lib/guards';
import { extractDealIds, normalizeDealId, resolve } from '@/lib/resolver';
import { generateJson, setProviderForTests } from '@/lib/llm';
import { analyze } from '@/lib/analyze';

const deal = (id: string) => getDeal(id)!;

// --- Critical: never call a value consistent when the data says otherwise ---
test('price complaint on a price/m² mismatch deal is not called consistent', () => {
  const f = verifyClaim(deal('D100313'), 'price');
  expect(f.verdict).toBe('CANNOT_DETERMINE');
  expect(f.allowed_numbers).toContain(80628);
  expect(f.facts_he.join(' ')).not.toContain('עקבי עם שאר');
  expect(f.facts_he.join(' ')).toContain('מחיר, שטח או מחיר למ"ר');
});

test('size complaint on a price/m² mismatch deal is not called consistent', () => {
  expect(verifyClaim(deal('D100313'), 'size').verdict).toBe('CANNOT_DETERMINE');
});

test('price complaint on a valid deal with missing size cannot claim consistency', () => {
  const noSize = loadDataset().deals.find((d) => d.status === 'VALID' && d.size_sqm === null)!;
  const f = verifyClaim(noSize, 'price');
  expect(f.verdict).toBe('CANNOT_DETERMINE');
  expect(f.rule_ids).toContain('MISSING_SIZE');
});

// --- Important: stated value is compared with the complaint's own field ---
test('a price/m² complaint quoting the file value does not say the value is absent', () => {
  const ok = verifyClaim(deal('D100124'), 'price_per_sqm', 39226);
  expect(ok.facts_he.join(' ')).not.toContain('אינו מופיע בנתונים');
  const bad = verifyClaim(deal('D100124'), 'price_per_sqm', 12345);
  expect(bad.facts_he.join(' ')).toContain('אינו מופיע בנתונים');
});

test('a stated price matching the non-primary row names that row', () => {
  const f = verifyClaim(deal('D100124'), 'price', 5429440);
  expect(f.rule_ids).toContain('STATED_MATCHES_NONPRIMARY');
  const text = f.facts_he.join(' ');
  expect(text).toContain('תואם לדיווח של מתווך');
  expect(text).toContain('5,429,440');
});

// --- Important: ids from the model must be grounded in the message ---
const claim = (o: object) => ({
  mentioned_deal_ids: [], city: null, neighborhood: null, street: null,
  field: 'two_prices', customer_stated_value: null, tone: 'calm', confidence: 0.9, ...o,
});
const REPLY = 'שלום, בדקנו את עסקה D100124. נמצאו שתי רשומות: ₪5,727,000 ו-₪5,429,440. תודה שפנית אלינו.';
function mock(c: object) {
  setProviderForTests(async (req) =>
    req.system.includes('extract a structured claim') ? JSON.stringify(c) : JSON.stringify({ reply_he: REPLY }));
}
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'k';
});
afterEach(() => {
  setProviderForTests(null);
  delete process.env.GEMINI_API_KEY;
});

test('an existing id the model invented (not in the message) is ignored', async () => {
  mock(claim({ mentioned_deal_ids: ['D100313', 'D100124'] }));
  const r = await analyze({ message: 'שני מחירים לעסקה D100124' });
  expect(r.state).toBe('RESOLVED');
  expect(r.deal?.deal_id).toBe('D100124');
});

test('a model id with nothing in the message to support it leaves nothing to look up', async () => {
  mock(claim({ mentioned_deal_ids: ['D100313'] }));
  const r = await analyze({ message: 'המחיר באתר לא נכון' });
  expect(r.state).toBe('MANUAL_NEEDED');
});

test('an unknown id next to a known one is reported to the CSM', async () => {
  mock(claim({ mentioned_deal_ids: ['D100124', 'D100999'] }));
  const r = await analyze({ message: 'בדקו D100124 וגם D100999' });
  expect(r.state).toBe('RESOLVED');
  expect(r.notices_he.join(' ')).toContain('D100999');
});

// --- Important: provider failures carry diagnosable detail, never the message ---
test('the JSON schema sent to the provider has no $schema key', async () => {
  let sent: unknown;
  setProviderForTests(async (req) => {
    sent = req.jsonSchema;
    return '{"a":"b"}';
  });
  await generateJson({ system: 's', prompt: 'p', schema: z.object({ a: z.string() }) });
  expect(sent).not.toHaveProperty('$schema');
});

test('PROVIDER_ERROR reports class and status but not the error message', async () => {
  setProviderForTests(async () => {
    throw Object.assign(new Error('secret-body-text'), { status: 429 });
  });
  const r = await generateJson({ system: 's', prompt: 'p', schema: z.object({ a: z.string() }), timeoutMs: 200 });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.detail).toContain('429');
    expect(r.detail).not.toContain('secret-body-text');
  }
});

// --- Important: counting words that carry a fact are rejected ---
test('reply guard rejects spelled-out counts above two but allows שני/שתי', () => {
  const f = verifyClaim(deal('D100313'), 'rooms');
  expect(guardReply('בדקנו את עסקה D100313. יש בה ארבעה חדרים.', f).ok).toBe(false);
  expect(guardReply('בדקנו את עסקה D100313. יש בה חמש חדרים.', f).ok).toBe(false);
  const g = verifyClaim(deal('D100124'), 'two_prices');
  expect(guardReply('בדקנו את עסקה D100124. נמצאו שתי רשומות ושני מחירים.', g)).toEqual({ ok: true });
});

// --- Important: resolver robustness ---
test('an unrecognised city spelling does not make a real street unfindable', () => {
  const d = loadDataset().deals.find((x) => x.street && x.city === 'ראשון לציון')!;
  const r = resolve({ deal_ids: [], city: 'ראשל"צ', street: d.street! });
  expect(r.kind === 'FOUND' || r.kind === 'AMBIGUOUS').toBe(true);
});

test('an id with an extra digit is not silently shortened to another deal', () => {
  expect(normalizeDealId('D1001245')).toBeNull();
  expect(extractDealIds('D1001245')).toEqual([]);
  expect(normalizeDealId('D100124')).toBe('D100124');
});
