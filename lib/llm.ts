import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

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
}
export type ProviderFn = (req: ProviderRequest) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 8000;
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

let override: ProviderFn | null = null;
export function setProviderForTests(fn: ProviderFn | null): void {
  override = fn;
}

const geminiProvider: ProviderFn = async ({ system, prompt, jsonSchema, signal }) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: MODEL,
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

const TIMED_OUT = Symbol('timed-out');

async function attempt(fn: ProviderFn, req: Omit<ProviderRequest, 'signal'>, budgetMs: number): Promise<string | typeof TIMED_OUT> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(TIMED_OUT);
    }, Math.max(budgetMs, 1));
  });
  try {
    return await Promise.race([fn({ ...req, signal: ctrl.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
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
  const fn = override ?? (process.env.GEMINI_API_KEY ? geminiProvider : null);
  if (!fn) return fail('NO_KEY');

  const budget = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(o.schema) as Record<string, unknown>;
  const req = { system: o.system, prompt: o.prompt, jsonSchema };
  let lastDetail: string | undefined;

  for (let tries = 0; tries < 2; tries++) {
    const left = budget - (Date.now() - start);
    if (left <= 0) return fail('TIMEOUT');
    let text: string | typeof TIMED_OUT;
    try {
      text = await attempt(fn, req, left);
    } catch (err) {
      // Class and HTTP status only; never the error message, which may echo request content.
      const e = err as { name?: string; status?: number };
      lastDetail = `${e?.name ?? 'Error'}${e?.status ? `:${e.status}` : ''}`;
      if (tries === 1) return fail('PROVIDER_ERROR', lastDetail);
      continue; // one retry on provider errors only
    }
    if (text === TIMED_OUT) return fail('TIMEOUT');
    try {
      const parsed = o.schema.safeParse(parseJson(text));
      if (!parsed.success) return fail('INVALID_JSON');
      return { ok: true, data: parsed.data, provider: override ? 'test' : 'gemini', ms: Date.now() - start };
    } catch {
      return fail('INVALID_JSON');
    }
  }
  return fail('PROVIDER_ERROR', lastDetail);
}
