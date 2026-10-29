import { extractClaim, type Claim } from './claim';
import { draftReply } from './reply';
import { guardClaim, guardReply } from './guards';
import { marketContext, type MarketContext } from './market';
import { extractDealIds, resolve } from './resolver';
import { templateReply, escalationNote } from './templates';
import { newTraceId, logEvent } from './trace';
import { verifyClaim, type Field, type VerifiedFacts } from './verifier';
import type { Simulate } from './llm';
import type { ProcessedDeal, RawRow } from './types';

export const MAX_MESSAGE_LENGTH = 800;
const MAX_REPLY_ATTEMPTS = 2;

export interface AnalyzeInput {
  message: string;
  deal_id?: string;
  picked_deal_id?: string;
  field?: Field;
  city?: string;
  neighborhood?: string;
  street?: string;
  stated_value?: number;
  simulate?: Simulate;
  simulate_reply?: Simulate;
}

export type AnalyzeState = 'RESOLVED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'MANUAL_NEEDED' | 'INVALID_INPUT';

export interface AnalyzeResult {
  trace_id: string;
  state: AnalyzeState;
  claim: Claim | null;
  extraction: 'LLM' | 'MANUAL' | 'FAILED';
  candidates: ProcessedDeal[];
  deal: ProcessedDeal | null;
  facts: VerifiedFacts | null;
  evidence_rows: RawRow[];
  market: MarketContext | null;
  reply: { text: string; source: 'LLM' | 'TEMPLATE'; guard_failures: string[] } | null;
  escalation_note: string | null;
  notices_he: string[];
  timings_ms: Record<string, number>;
  debug: { extraction_failure?: string; reply_failure?: string; providers: { extract?: string; reply?: string } };
}

const N = {
  extractionDown: 'הבנת התלונה אוטומטית אינה זמינה כרגע. מלאו את הפרטים ידנית והבדיקה תמשיך כרגיל.',
  nothingToLookUp: 'לא זוהתה עסקה בתלונה. הזינו מזהה עסקה או רחוב ועיר.',
  replyTemplate: 'טיוטת ה-AI אינה זמינה כרגע, ולכן מוצגת תבנית תשובה מוכנה.',
  invalid: `נא להזין את הודעת הלקוח (עד ${MAX_MESSAGE_LENGTH} תווים) או מזהה עסקה.`,
};

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const t0 = Date.now();
  const trace_id = newTraceId();
  const timings_ms: Record<string, number> = {};
  const message = (input.message ?? '').trim();

  const result: AnalyzeResult = {
    trace_id, state: 'INVALID_INPUT', claim: null, extraction: 'MANUAL', candidates: [], deal: null,
    facts: null, evidence_rows: [], market: null, reply: null, escalation_note: null,
    notices_he: [], timings_ms, debug: { providers: {} },
  };
  const finish = (state: AnalyzeState): AnalyzeResult => {
    result.state = state;
    timings_ms.total = Date.now() - t0;
    logEvent({
      trace_id, state, verdict: result.facts?.verdict ?? null, deal_id: result.deal?.deal_id ?? null,
      extraction: result.extraction, extraction_failure: result.debug.extraction_failure ?? null, reply_failure: result.debug.reply_failure ?? null,
      reply_source: result.reply?.source ?? null, reply_guard_failures: result.reply?.guard_failures.length ?? 0,
      providers: result.debug.providers, timings_ms,
    });
    return result;
  };

  const hasManualTarget = !!(input.deal_id || input.picked_deal_id || input.street || input.neighborhood);
  if (message.length > MAX_MESSAGE_LENGTH || (!message && !hasManualTarget)) {
    result.notices_he.push(N.invalid);
    return finish('INVALID_INPUT');
  }

  // Step 1: claim extraction (LLM) or manual inputs.
  let claim: Claim | null = null;
  if (message) {
    const e = await extractClaim(message, input.simulate);
    timings_ms.extract = e.ms;
    if (e.ok) {
      const g = guardClaim(e.claim);
      if (g.ok) {
        claim = g.claim;
        result.extraction = 'LLM';
        result.debug.providers.extract = e.provider;
      } else {
        result.debug.extraction_failure = g.reason;
      }
    } else {
      result.debug.extraction_failure = e.reason;
    }
    if (!claim) {
      const hasTarget = hasManualTarget || extractDealIds(message).length > 0;
      result.notices_he.push(N.extractionDown);
      result.extraction = input.field && hasTarget ? 'MANUAL' : 'FAILED';
      if (result.extraction === 'FAILED') return finish('MANUAL_NEEDED');
    }
  }
  result.claim = claim;

  const field: Field = input.field ?? claim?.field ?? 'other';
  const ids = input.picked_deal_id
    ? [input.picked_deal_id]
    : [...new Set([input.deal_id, ...(claim?.mentioned_deal_ids ?? []), ...extractDealIds(message)].filter((x): x is string => !!x))];
  const city = input.city ?? claim?.city ?? null;
  const street = input.street ?? claim?.street ?? null;
  const neighborhood = input.neighborhood ?? claim?.neighborhood ?? null;
  const stated = input.stated_value ?? claim?.customer_stated_value ?? null;

  if (!ids.length && !street && !neighborhood) {
    result.notices_he.push(N.nothingToLookUp);
    return finish('MANUAL_NEEDED');
  }

  // Step 2: resolve to a deal. Never auto-pick when several match.
  const res = resolve({ deal_ids: ids, city, street, neighborhood, stated_value: stated });
  if (res.kind === 'AMBIGUOUS') {
    result.candidates = res.candidates;
    return finish('AMBIGUOUS');
  }
  const deal = res.kind === 'FOUND' ? res.deal : undefined;

  // Step 3: deterministic verification.
  const t1 = Date.now();
  const facts = verifyClaim(deal, field, stated);
  timings_ms.verify = Date.now() - t1;
  result.facts = facts;
  result.deal = deal ?? null;
  result.evidence_rows = deal?.raw_rows ?? [];
  result.market = deal ? marketContext(deal) : null;

  // Step 4: reply draft (LLM, guarded) with template fallback.
  const modelSuspect = result.extraction === 'MANUAL' && message.length > 0;
  const guard_failures: string[] = [];
  let reply: AnalyzeResult['reply'] = null;
  if (facts.verdict !== 'DEAL_NOT_FOUND' && !modelSuspect) {
    for (let i = 0; i < MAX_REPLY_ATTEMPTS && !reply; i++) {
      const d = await draftReply(facts, claim?.tone ?? 'calm', input.simulate_reply);
      timings_ms.reply = (timings_ms.reply ?? 0) + d.ms;
      if (!d.ok) {
        result.debug.reply_failure = d.reason;
        break;
      }
      const g = guardReply(d.text, facts);
      if (g.ok) {
        reply = { text: d.text, source: 'LLM', guard_failures };
        result.debug.providers.reply = d.provider;
      } else {
        guard_failures.push(...g.reasons);
      }
    }
  }
  if (!reply) {
    reply = { text: templateReply(facts), source: 'TEMPLATE', guard_failures };
    if (facts.verdict !== 'DEAL_NOT_FOUND' && !modelSuspect) result.notices_he.push(N.replyTemplate);
  }
  result.reply = reply;

  // Step 5: escalation note, deterministic.
  if (facts.verdict === 'CANNOT_DETERMINE' || facts.verdict === 'SOURCES_CONFLICT') {
    result.escalation_note = escalationNote(facts, trace_id);
  }
  return finish(res.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'RESOLVED');
}

