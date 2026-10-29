import { test, expect } from 'vitest';
import { getDeal } from '@/lib/data';
import { verifyClaim, type VerifiedFacts } from '@/lib/verifier';
import { guardReply } from '@/lib/guards';
import { templateReply, escalationNote } from '@/lib/templates';

const cases: Record<string, VerifiedFacts> = {
  RAW_VALUE_WRONG: verifyClaim(getDeal('D100313'), 'price_per_sqm'),
  SOURCES_CONFLICT: verifyClaim(getDeal('D100124'), 'two_prices'),
  RAW_VALUE_OK: verifyClaim(getDeal('D100313'), 'size'),
  CANNOT_DETERMINE: verifyClaim(getDeal('D100313'), 'other'),
  DEAL_NOT_FOUND: verifyClaim(undefined, 'price'),
};

test('every verdict has a Hebrew template that passes the reply guard', () => {
  for (const [verdict, facts] of Object.entries(cases)) {
    expect(facts.verdict).toBe(verdict);
    const text = templateReply(facts);
    expect(text).toMatch(/[֐-׿]/);
    expect(guardReply(text, facts), verdict).toEqual({ ok: true });
  }
});

test('the conflict template names both figures and the reason', () => {
  const text = templateReply(cases.SOURCES_CONFLICT);
  expect(text).toContain('5,727,000');
  expect(text).toContain('5,429,440');
  expect(text).toContain('המחיר למ"ר');
});

test('the owner-vs-broker conflict template says there is no Tax Authority row', () => {
  const text = templateReply(verifyClaim(getDeal('D100032'), 'two_prices'));
  expect(text).toContain('אין בקובץ רשומה של רשות המסים');
});

test('escalation note carries trace id, deal id, rule ids and what is unknown', () => {
  const note = escalationNote(cases.CANNOT_DETERMINE, 'trc_abcd1234');
  expect(note).toContain('trc_abcd1234');
  expect(note).toContain('D100313');
  expect(note).toContain('FIELD_NOT_IN_DATA');
  expect(note).toContain('מה לא ידוע:');
});
