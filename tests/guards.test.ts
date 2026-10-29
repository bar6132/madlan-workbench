import { test, expect } from 'vitest';
import { getDeal } from '@/lib/data';
import { verifyClaim } from '@/lib/verifier';
import { guardClaim, guardReply, BANNED_PHRASES } from '@/lib/guards';
import type { Claim } from '@/lib/claim';

const facts = verifyClaim(getDeal('D100124'), 'two_prices');
const baseClaim: Claim = {
  mentioned_deal_ids: ['d100124'], city: null, neighborhood: null, street: null,
  field: 'two_prices', customer_stated_value: null, tone: 'upset', confidence: 0.8,
};

test('guardClaim normalizes ids, flags unknown ones, drops malformed ones', () => {
  const r = guardClaim({ ...baseClaim, mentioned_deal_ids: ['d100124', 'D100999', 'דירה12', ' D100 313 '] });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.claim.mentioned_deal_ids).toEqual(['D100124', 'D100999', 'D100313']);
    expect(r.unknown_ids).toEqual(['D100999']);
  }
});

test('guardClaim rejects implausible stated values', () => {
  expect(guardClaim({ ...baseClaim, customer_stated_value: -5 }).ok).toBe(false);
  expect(guardClaim({ ...baseClaim, customer_stated_value: 1e12 }).ok).toBe(false);
  expect(guardClaim({ ...baseClaim, customer_stated_value: 3100000 }).ok).toBe(true);
});

test('guardReply accepts a reply built only from allowed ids and numbers', () => {
  const ok = 'שלום, בדקנו את D100124. נמצאו שני מחירים: ₪5,727,000 ו-5429440. תודה.';
  expect(guardReply(ok, facts)).toEqual({ ok: true });
});

test('guardReply rejects an invented deal id', () => {
  const r = guardReply('בדקנו את D100999 ואת D100124.', facts);
  expect(r.ok).toBe(false);
});

test('guardReply rejects a number that is not in the facts', () => {
  const r = guardReply('המחיר הוא 5,300,000 ש"ח.', facts);
  expect(r.ok).toBe(false);
});

test('guardReply rejects million-words and spelled-out amounts', () => {
  expect(guardReply('המחיר הוא 5.7 מיליון ש"ח', facts).ok).toBe(false);
  expect(guardReply('המחיר הוא שלושה מיליון', facts).ok).toBe(false);
});

test('guardReply rejects every banned phrase', () => {
  for (const p of BANNED_PHRASES) {
    expect(guardReply(`בדקנו את הנתון. ${p} ולכן כך.`, facts).ok, p).toBe(false);
  }
});

test('guardReply rejects empty or non-Hebrew text', () => {
  expect(guardReply('', facts).ok).toBe(false);
  expect(guardReply('We checked it for you.', facts).ok).toBe(false);
});

test('guardReply rejects Arabic letters mixed into a Hebrew reply (real model output)', () => {
  const bad = 'שלום, בדקנו את D100124. הנתונים אינם יכולים ליישב את השؤالה.';
  const r = guardReply(bad, facts);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain('FOREIGN_SCRIPT');
});

test('guardReply still accepts shekel sign, quotes and Latin ids', () => {
  const ok = 'שלום, בדקנו את D100124 (מ"ר). המחיר ₪5,727,000 – תודה.';
  expect(guardReply(ok, facts)).toEqual({ ok: true });
});

test('guardReply rejects first-person action claims', () => {
  const r = guardReply('שלום, בדקנו את D100124. הפניתי את הנושא לבדיקה.', facts);
  expect(r.ok).toBe(false);
});
