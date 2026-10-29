import type { Claim } from './claim';
import type { VerifiedFacts } from './verifier';
import { getDeal } from './data';
import { extractDealIds } from './resolver';

export const BANNED_PHRASES = [
  'שונה', 'זייף', 'זויף', 'הוחלף', 'מישהו שינה', 'נתקן עד', 'נעדכן מחר', 'הבטחה', 'אשמה',
];
const MAGNITUDE_WORDS = /מיליון|מליון|מיליארד|אלפי|אלף/;
// Counts above two spelled out as words; שני/שתי stay allowed (used in our own templates).
const COUNT_WORDS = /(?:^|[^\u0590-\u05FF])[בלוהכמ]?(?:שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שש|שבעה|שבע|שמונה|תשעה|תשע|עשרה|עשר)(?![\u0590-\u05FF])/;
const MAX_STATED_VALUE = 1e10;

export type ClaimGuard =
  | { ok: true; claim: Claim; unknown_ids: string[] }
  | { ok: false; reason: string };

export function guardClaim(claim: Claim): ClaimGuard {
  const v = claim.customer_stated_value;
  if (v !== null && (!Number.isFinite(v) || v < 0 || v > MAX_STATED_VALUE)) {
    return { ok: false, reason: 'IMPLAUSIBLE_STATED_VALUE' };
  }
  const ids = [...new Set(claim.mentioned_deal_ids.flatMap(extractDealIds))];
  return {
    ok: true,
    claim: { ...claim, mentioned_deal_ids: ids },
    unknown_ids: ids.filter((id) => !getDeal(id)),
  };
}

export type ReplyGuard = { ok: true } | { ok: false; reasons: string[] };

export function guardReply(text: string, facts: VerifiedFacts): ReplyGuard {
  const reasons: string[] = [];
  if (!/[֐-׿]/.test(text)) reasons.push('NOT_HEBREW');

  for (const id of extractDealIds(text)) {
    if (!facts.allowed_deal_ids.includes(id)) reasons.push(`UNKNOWN_DEAL_ID:${id}`);
  }
  const withoutIds = text.replace(/D(?:\s*\d){6}/gi, ' ');
  for (const token of withoutIds.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const n = Number(token.replace(/,/g, ''));
    if (!facts.allowed_numbers.includes(n)) reasons.push(`UNVERIFIED_NUMBER:${token}`);
  }
  if (MAGNITUDE_WORDS.test(text) || COUNT_WORDS.test(text)) reasons.push('NUMBER_WORDS_NOT_SUPPORTED');
  for (const p of BANNED_PHRASES) {
    if (text.includes(p)) reasons.push(`BANNED_PHRASE:${p}`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
