import { z } from 'zod';
import { generateJson, type Simulate } from './llm';
import type { Claim } from './claim';
import type { VerifiedFacts } from './verifier';

export type ReplyResult =
  | { ok: true; text: string; provider: string; ms: number }
  | { ok: false; reason: string; ms: number; detail?: string };

const ReplySchema = z.object({ reply_he: z.string().min(10) });

const SYSTEM = `You write a short, polite reply in Hebrew from a Madlan customer-success manager to a customer who says a number is wrong.
Use ONLY the facts provided in <verified_facts>. Do not compute anything. Write every number and deal id exactly as given, using digits (for example 5,727,000), never words like "million".
Do not state or guess causes, do not blame anyone, and do not promise fixes or timelines.
If the verdict is CANNOT_DETERMINE, say plainly that the data does not settle the question and that it was passed on for review.
Return ONLY JSON: {"reply_he": "..."}. Length: 3-6 sentences. Match the tone label (calm, upset, angry) with empathy but no apology for things not in the facts.`;

export async function draftReply(facts: VerifiedFacts, tone: Claim['tone'], simulate?: Simulate): Promise<ReplyResult> {
  const payload = {
    verdict: facts.verdict,
    deal_id: facts.deal_id,
    facts_he: facts.facts_he,
    conflict: facts.conflict ?? null,
  };
  const r = await generateJson({
    system: SYSTEM,
    prompt: `<tone>${tone}</tone>\n<verified_facts>${JSON.stringify(payload, null, 1)}</verified_facts>`,
    schema: ReplySchema,
    simulate,
  });
  return r.ok ? { ok: true, text: r.data.reply_he, provider: r.provider, ms: r.ms } : { ok: false, reason: r.reason, ms: r.ms, detail: r.detail };
}
