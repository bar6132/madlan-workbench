import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { buildTargets, cooldown, type Target } from './gemini-pool';

export type Simulate = 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_JSON' | 'NONE';
export type LlmFailure = 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_JSON' | 'NO_KEY';
export type LlmResult<T> =
  | { ok: true; data: T; provider: string; ms: number }
  | { ok: false; reason: LlmFailure; ms: number; detail?: string };

export interface ProviderRequest {
  system: string;
  prompt: string;
  jsonSchema: unknown;
  signal: AbortSignal;
  /** Which key and model to use. Absent for the injected test provider. */
  target?: Target;
}
export type ProviderFn = (req: ProviderRequest) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 15000;
// Free-tier latency is usually 1-2 s but spikes to 6-27 s. If an attempt has not answered after this long,
// the next key/model is started in parallel and the first answer wins.
const HEDGE_AFTER_MS = 3500;

let override: ProviderFn | null = null;
export function setProviderForTests(fn: ProviderFn | null): void {
  override = fn;
}

const geminiProvider: ProviderFn = async ({ system, prompt, jsonSchema, signal, target }) => {
  if (!target) throw new Error('no target');
  const ai = new GoogleGenAI({ apiKey: target.apiKey });
  const res = await ai.models.generateContent({
    model: target.model,
    contents: prompt,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      temperature: 0.1,
      abortSignal: signal,
    },
  });
  return res.text ?? '';
};

interface HedgedOutcome {
  text: string | null;
  target?: Target;
  timedOut: boolean;
  trail: string[];
}

/**
 * Tries targets in order. The next one starts when the current one fails, or when it has been silent for
 * HEDGE_AFTER_MS, whichever is first. The first answer wins and the others are aborted.
 * Gives up when every target has failed or the overall budget is spent.
 */
function hedged(fn: ProviderFn, req: Omit<ProviderRequest, 'signal' | 'target'>, targets: Array<Target | undefined>, budgetMs: number): Promise<HedgedOutcome> {
  return new Promise((resolve) => {
    const trail: string[] = [];
    const ctrls: AbortController[] = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let next = 0;
    let pending = 0;
    let done = false;

    const finish = (o: Omit<HedgedOutcome, 'trail'>) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      ctrls.forEach((c) => c.abort());
      resolve({ ...o, trail });
    };

    const launch = () => {
      if (done || next >= targets.length) return;
      const target = targets[next++];
      const label = target?.id ?? 'test';
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      pending++;
      if (next < targets.length) {
        timers.push(setTimeout(() => {
          if (done) return;
          trail.push(`${label}:slow`);
          launch();
        }, HEDGE_AFTER_MS));
      }
      fn({ ...req, target, signal: ctrl.signal }).then(
        (text) => {
          pending--;
          finish({ text, target, timedOut: false });
        },
        (err: { name?: string; status?: number }) => {
          pending--;
          if (done) return; // aborted because another attempt already won
          // Class and HTTP status only; never the error message, which may echo request content.
          trail.push(`${label}:${err?.status ?? err?.name ?? 'Error'}`);
          if (target) cooldown(target, err?.status);
          if (next < targets.length) launch();
          else if (pending === 0) finish({ text: null, timedOut: false });
        },
      );
    };

    timers.push(setTimeout(() => finish({ text: null, timedOut: true }), Math.max(budgetMs, 1)));
    launch();
  });
}

function parseJson(text: string): unknown {
  const t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : t);
}

export async function generateJson<T>(o: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  simulate?: Simulate;
}): Promise<LlmResult<T>> {
  const start = Date.now();
  const fail = (reason: LlmFailure, detail?: string): LlmResult<T> => ({
    ok: false, reason, ms: Date.now() - start, ...(detail ? { detail } : {}),
  });

  if (o.simulate && o.simulate !== 'NONE') return fail(o.simulate, 'simulated');
  // Real runs: every (key, model) pair in priority order. Tests: the injected provider, tried twice.
  const fn: ProviderFn = override ?? geminiProvider;
  const targets: Array<Target | undefined> = override ? [undefined, undefined] : buildTargets();
  if (!targets.length) return fail('NO_KEY');

  const budget = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(o.schema) as Record<string, unknown>;
  const req = { system: o.system, prompt: o.prompt, jsonSchema };
  const out = await hedged(fn, req, targets, budget);
  const detail = out.trail.join(',');
  if (out.text === null) return fail(out.timedOut ? 'TIMEOUT' : 'PROVIDER_ERROR', detail);
  try {
    const parsed = o.schema.safeParse(parseJson(out.text));
    // A model that answered with bad JSON is not retried on another model: the answer, not the service, is wrong.
    if (!parsed.success) return fail('INVALID_JSON', detail);
    return { ok: true, data: parsed.data, provider: out.target ? `gemini:${out.target.id}` : 'test', ms: Date.now() - start };
  } catch {
    return fail('INVALID_JSON', detail);
  }
}
