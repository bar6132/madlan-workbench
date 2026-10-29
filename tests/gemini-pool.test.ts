import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { buildTargets, cooldown, resetPoolForTests, DEFAULT_MODELS } from '@/lib/gemini-pool';

const KEYS = { GEMINI_API_KEY: 'key-a', GEMINI_V2_API_KEY: 'key-b' };

beforeEach(() => resetPoolForTests());

test('primary model is tried on both keys before any fallback model', () => {
  const t = buildTargets(KEYS);
  expect(t).toHaveLength(DEFAULT_MODELS.length * 2);
  expect(t.slice(0, 2).map((x) => x.model)).toEqual([DEFAULT_MODELS[0], DEFAULT_MODELS[0]]);
  expect(new Set(t.slice(0, 2).map((x) => x.keyLabel))).toEqual(new Set(['A', 'B']));
  expect(t.slice(2, 4).every((x) => x.model === DEFAULT_MODELS[1])).toBe(true);
});

test('the first key alternates between calls (load spreading)', () => {
  const first = [buildTargets(KEYS)[0].keyLabel, buildTargets(KEYS)[0].keyLabel, buildTargets(KEYS)[0].keyLabel];
  expect(first).toEqual(['A', 'B', 'A']);
});

test('one key only, a duplicated key, or no key', () => {
  expect(buildTargets({ GEMINI_API_KEY: 'k' })).toHaveLength(DEFAULT_MODELS.length);
  expect(buildTargets({ GEMINI_API_KEY: 'k', GEMINI_V2_API_KEY: 'k' })).toHaveLength(DEFAULT_MODELS.length);
  expect(buildTargets({})).toEqual([]);
});

test('GEMINI_MODELS overrides the model list', () => {
  const t = buildTargets({ ...KEYS, GEMINI_MODELS: 'm1, m2' });
  expect(t.map((x) => x.model).sort()).toEqual(['m1', 'm1', 'm2', 'm2']);
});

test('a rate-limited target is skipped during its cooldown, then returns', () => {
  const now = 1_000_000;
  const [victim] = buildTargets(KEYS, now);
  cooldown(victim, 429, now);
  expect(buildTargets(KEYS, now + 1000).some((x) => x.id === victim.id)).toBe(false);
  expect(buildTargets(KEYS, now + 61_000).some((x) => x.id === victim.id)).toBe(true);
});

test('if every target is cooling down the full list is still returned', () => {
  const now = 5_000_000;
  for (const t of buildTargets(KEYS, now)) cooldown(t, 429, now);
  expect(buildTargets(KEYS, now + 1000)).toHaveLength(DEFAULT_MODELS.length * 2);
});

test('target ids never contain the key', () => {
  for (const t of buildTargets(KEYS)) expect(t.id).not.toMatch(/key-/);
});

// ---- failover through generateJson, with the Google SDK mocked ----
const calls: Array<{ key: string; model: string }> = [];
let behave: (key: string, model: string) => string | { status: number } | { hang: true };

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(private o: { apiKey: string }) {}
    models = {
      generateContent: async ({ model }: { model: string }) => {
        calls.push({ key: this.o.apiKey, model });
        const r = behave(this.o.apiKey, model);
        if (typeof r === 'object' && 'hang' in r) return new Promise(() => {});
        if (typeof r !== 'string') throw Object.assign(new Error('quota'), { name: 'ApiError', status: r.status });
        return { text: r };
      },
    };
  },
}));

const schema = z.object({ ok: z.boolean() });

async function run() {
  const { generateJson } = await import('@/lib/llm');
  return generateJson({ system: 's', prompt: 'p', schema });
}

const saved = { a: process.env.GEMINI_API_KEY, b: process.env.GEMINI_V2_API_KEY };
beforeEach(() => {
  calls.length = 0;
  process.env.GEMINI_API_KEY = 'key-a';
  process.env.GEMINI_V2_API_KEY = 'key-b';
});
afterEach(() => {
  if (saved.a === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.a;
  if (saved.b === undefined) delete process.env.GEMINI_V2_API_KEY; else process.env.GEMINI_V2_API_KEY = saved.b;
});

test('key A rate-limited: the other key answers on the same primary model', async () => {
  behave = (key) => (key === 'key-a' ? { status: 429 } : '{"ok":true}');
  const r = await run();
  expect(r.ok).toBe(true);
  expect(calls.every((c) => c.model === DEFAULT_MODELS[0])).toBe(true);
  if (r.ok) expect(r.provider).toMatch(/^gemini:gemini-3\.1-flash-lite#B$/);
});

test('both keys exhausted on the primary model: a fallback model answers', async () => {
  behave = (_key, model) => (model === DEFAULT_MODELS[0] ? { status: 429 } : '{"ok":true}');
  const r = await run();
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.provider).toContain(DEFAULT_MODELS[1]);
});

test('everything fails: PROVIDER_ERROR with a trail of ids and statuses, and no key in it', async () => {
  behave = () => ({ status: 429 });
  const r = await run();
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe('PROVIDER_ERROR');
    expect(r.detail).toContain('gemini-3.1-flash-lite#A:429');
    expect(r.detail).not.toMatch(/key-/);
  }
  expect(calls).toHaveLength(DEFAULT_MODELS.length * 2);
});

test('invalid JSON from the model does not trigger failover', async () => {
  behave = () => 'not json';
  const r = await run();
  expect(r.ok).toBe(false);
  expect(calls).toHaveLength(1);
});

test('a silent first attempt does not stall: the next key starts after the hedge delay and its answer wins', async () => {
  vi.useFakeTimers();
  try {
    behave = (key) => (key === 'key-a' ? { hang: true } : '{"ok":true}');
    const p = run();
    await vi.advanceTimersByTimeAsync(3600);
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toMatch(/#B$/);
    expect(calls).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

test('a fast first answer never starts a second attempt', async () => {
  behave = () => '{"ok":true}';
  const r = await run();
  expect(r.ok).toBe(true);
  expect(calls).toHaveLength(1);
});

test('everything hangs: TIMEOUT at the budget, not a stuck request', async () => {
  vi.useFakeTimers();
  try {
    behave = () => ({ hang: true });
    const p = run();
    await vi.advanceTimersByTimeAsync(15100);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('TIMEOUT');
      expect(r.detail).toContain('#A:slow');
    }
  } finally {
    vi.useRealTimers();
  }
});
