import { test, expect, beforeEach, afterEach } from 'vitest';
import { analyze } from '@/lib/analyze';
import { getDeal, loadDataset } from '@/lib/data';
import { guardReply } from '@/lib/guards';
import { setProviderForTests } from '@/lib/llm';
import { templateReply } from '@/lib/templates';
import { verifyClaim } from '@/lib/verifier';

// "It says חדש מקבלן but the flat is very old": the file does contain this contradiction (flag NEW_BUILD_OLD_YEAR),
// and the complaint tool must say so instead of answering "not in the data".

test('D100365: a new-build label with a 1984 building year is reported as inconsistent, with both values', () => {
  const f = verifyClaim(getDeal('D100365'), 'property_details');
  expect(f.verdict).toBe('RAW_VALUE_WRONG');
  expect(f.rule_ids).toContain('NEW_BUILD_OLD_YEAR');
  const text = f.facts_he.join(' ');
  expect(text).toContain('חדש מקבלן');
  expect(text).toContain('1984');
  expect(text).toContain('אינם מאפשרים לקבוע איזה מהם שגוי'); // it does not claim to know which field is wrong
  expect(f.allowed_numbers).toContain(1984);
});

test('a year-built after the deal year is reported the same way', () => {
  const f = verifyClaim(getDeal('D100056'), 'property_details');
  expect(f.verdict).toBe('RAW_VALUE_WRONG');
  expect(f.rule_ids).toContain('TIMELINE_CONTRADICTION');
});

test('a deal with no contradiction: the recorded details are listed and the answer says they cannot be checked against reality', () => {
  const clean = loadDataset().deals.find((d) => !d.flags.includes('NEW_BUILD_OLD_YEAR') && !d.flags.includes('TIMELINE_CONTRADICTION') && d.year_built && d.condition)!;
  const f = verifyClaim(clean, 'property_details');
  expect(f.verdict).toBe('RAW_VALUE_OK');
  expect(f.facts_he.join(' ')).toContain(String(clean.year_built));
  expect(f.facts_he.join(' ')).toContain('אינם מאפשרים לבדוק אותם מול המציאות');
});

test('missing values are shown as unknown, never as "no"', () => {
  const d = loadDataset().deals.find((x) => x.has_parking === null)!;
  expect(verifyClaim(d, 'property_details').facts_he.join(' ')).toContain('חניה — לא ידוע');
});

test('the template reply for it is Hebrew, uses only verified numbers and passes the reply guard', () => {
  const f = verifyClaim(getDeal('D100365'), 'property_details');
  expect(guardReply(templateReply(f), f)).toEqual({ ok: true });
});

test('a balcony AREA question is still "not in the data" (only the yes/no is recorded)', () => {
  expect(verifyClaim(getDeal('D100365'), 'other').verdict).toBe('CANNOT_DETERMINE');
});

// ---- the customer's own message, bare digits and all ----
beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
afterEach(() => { setProviderForTests(null); delete process.env.GEMINI_API_KEY; });

test('"I have a problem with 100365: it says new-build but the flat is very old" ends in the inconsistency verdict', async () => {
  const GOOD = 'שלום, בדקנו את עסקה D100365. בקובץ רשום מצב חדש מקבלן ושנת בנייה 1984, ושני הנתונים אינם מתיישבים זה עם זה. תודה.';
  setProviderForTests(async (req) => {
    if (req.system.includes('extract a structured claim')) {
      return JSON.stringify({
        mentioned_deal_ids: [], city: null, neighborhood: null, street: null, field: 'property_details',
        customer_stated_value: null, tone: 'upset', confidence: 0.9, intent: 'COMPLAINT',
      });
    }
    return JSON.stringify({ reply_he: GOOD });
  });
  const r = await analyze({ message: 'יש לי בעיה עם 100365 כתוב חדש מקבלן אבל הדירה ממש ישנה איך זה יתכן ?' });
  expect(r.state).toBe('RESOLVED');
  expect(r.deal?.deal_id).toBe('D100365');
  expect(r.facts?.verdict).toBe('RAW_VALUE_WRONG');
  expect(r.facts?.field).toBe('property_details');
  expect(r.reply?.source).toBe('LLM');
  expect(r.escalation_note).toContain('D100365'); // the reply says it was passed on, so there must be something to pass on
  expect(r.notices_he.join(' ')).toContain('לפי הספרות בלבד');
});
