import { test, expect } from 'vitest';
import { toView, type ApiResponse } from '@/lib/view';

const base = {
  trace_id: 'trc_1234abcd', claim: null, extraction: 'LLM', candidates: [], deal: null, facts: null,
  evidence_rows: [], market: null, market_raw: null, reply: null, escalation_note: null, notices_he: [],
  timings_ms: {}, debug: { providers: {} },
};
const facts = (verdict: string) => ({ verdict, field: 'price', deal_id: 'D100124' });
const r = (o: object) => ({ ...base, ...o }) as unknown as ApiResponse;

test('MANUAL_NEEDED shows only the manual form with the model-down banner', () => {
  const v = toView(r({ state: 'MANUAL_NEEDED', extraction: 'FAILED', notices_he: ['הבנת התלונה אוטומטית אינה זמינה כרגע. מלאו ידנית.'] }));
  expect(v.showManualForm).toBe(true);
  expect(v.banner?.text_he).toContain('הבנת התלונה אוטומטית אינה זמינה כרגע');
  expect([v.showPicker, v.showVerdict, v.showReply, v.showEscalation, v.showMarket]).toEqual([false, false, false, false, false]);
});

test('AMBIGUOUS shows the picker only', () => {
  const v = toView(r({ state: 'AMBIGUOUS', candidates: [{}, {}] }));
  expect(v.showPicker).toBe(true);
  expect([v.showManualForm, v.showVerdict, v.showReply]).toEqual([false, false, false]);
});

test('NOT_FOUND shows a warning banner, the verdict and a template reply', () => {
  const v = toView(r({ state: 'NOT_FOUND', facts: facts('DEAL_NOT_FOUND'), reply: { text: 'x', source: 'TEMPLATE', guard_failures: [] } }));
  expect(v.banner?.kind).toBe('warn');
  expect(v.showVerdict).toBe(true);
  expect(v.showMarket).toBe(false);
  expect(v.replyLabel_he).toBe('תבנית מוכנה');
});

test('RESOLVED labels the reply by its source', () => {
  const llm = toView(r({ state: 'RESOLVED', deal: {}, market: {}, facts: facts('RAW_VALUE_OK'), reply: { text: 'x', source: 'LLM', guard_failures: [] } }));
  expect(llm.replyLabel_he).toBe('טיוטה שנוצרה ב-AI');
  expect(llm.showMarket).toBe(true);
  const tpl = toView(r({ state: 'RESOLVED', deal: {}, market: {}, facts: facts('RAW_VALUE_OK'), reply: { text: 'x', source: 'TEMPLATE', guard_failures: [] } }));
  expect(tpl.replyLabel_he).toBe('תבנית מוכנה');
});

test('escalation shows only when the response carries a note', () => {
  const yes = toView(r({ state: 'RESOLVED', deal: {}, facts: facts('CANNOT_DETERMINE'), reply: { text: 'x', source: 'TEMPLATE', guard_failures: [] }, escalation_note: 'note' }));
  const no = toView(r({ state: 'RESOLVED', deal: {}, facts: facts('RAW_VALUE_OK'), reply: { text: 'x', source: 'LLM', guard_failures: [] } }));
  expect(yes.showEscalation).toBe(true);
  expect(no.showEscalation).toBe(false);
});

test('rate-limited and error responses show one error banner with the trace id', () => {
  const rl = toView({ state: 'RATE_LIMITED', notices_he: ['יותר מדי בקשות.'], trace_id: 'trc_aaaa1111' });
  expect(rl.banner).toMatchObject({ kind: 'error' });
  expect(rl.banner?.text_he).toContain('trc_aaaa1111');
  const er = toView({ state: 'ERROR', notices_he: ['אירעה תקלה.'], trace_id: 'trc_bbbb2222' });
  expect(er.banner?.text_he).toContain('trc_bbbb2222');
  for (const v of [rl, er]) {
    expect([v.showManualForm, v.showPicker, v.showVerdict, v.showReply, v.showEscalation, v.showMarket]).toEqual([false, false, false, false, false, false]);
  }
});

test('INVALID_INPUT is a warning with no result sections', () => {
  const v = toView(r({ state: 'INVALID_INPUT', notices_he: ['נא להזין הודעה.'] }));
  expect(v.banner?.kind).toBe('warn');
  expect(v.showVerdict).toBe(false);
});

test('a model-down notice on a resolved result is an info banner', () => {
  const v = toView(r({ state: 'RESOLVED', extraction: 'MANUAL', deal: {}, facts: facts('RAW_VALUE_OK'), notices_he: ['הבנת התלונה אוטומטית אינה זמינה כרגע.'], reply: { text: 'x', source: 'TEMPLATE', guard_failures: [] } }));
  expect(v.banner?.kind).toBe('info');
});
