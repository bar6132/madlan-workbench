// Chooses which (API key, model) pair to try next. Pure bookkeeping: no network, no secrets in any exported string.

export interface Target {
  /** Safe to log: model and key label only, never the key itself. */
  id: string;
  keyLabel: string;
  model: string;
  apiKey: string;
}

const KEY_ENVS: ReadonlyArray<readonly [label: string, env: string]> = [
  ['A', 'GEMINI_API_KEY'],
  ['B', 'GEMINI_V2_API_KEY'],
];

// Tier 1 is tried on every key before any later model. Override with GEMINI_MODELS="a,b,c".
export const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

type EnvLike = Record<string, string | undefined>;

const COOLDOWN_MS = { quota: 60_000, rejected: 600_000, other: 10_000 } as const;

const coolingUntil = new Map<string, number>();
let rotation = 0;

export function modelList(env: EnvLike = process.env): string[] {
  const fromEnv = (env.GEMINI_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_MODELS;
}

/** Ordered attempts: for each model tier, keys alternate (round-robin start) so load spreads across keys. */
export function buildTargets(env: EnvLike = process.env, now: number = Date.now()): Target[] {
  const seen = new Set<string>();
  const keys = KEY_ENVS.flatMap(([keyLabel, name]) => {
    const apiKey = (env[name] ?? '').trim();
    if (!apiKey || seen.has(apiKey)) return [];
    seen.add(apiKey);
    return [{ keyLabel, apiKey }];
  });
  if (!keys.length) return [];

  const start = rotation++ % keys.length;
  const all = modelList(env).flatMap((model) =>
    keys.map((_, i) => {
      const k = keys[(start + i) % keys.length];
      return { id: `${model}#${k.keyLabel}`, keyLabel: k.keyLabel, model, apiKey: k.apiKey };
    }),
  );
  const ready = all.filter((t) => (coolingUntil.get(t.id) ?? 0) <= now);
  // If everything is cooling down, still try: a stale cooldown must never produce a hard NO_KEY.
  return ready.length ? ready : all;
}

export function cooldown(target: Target, status: number | undefined, now: number = Date.now()): void {
  const ms = status === 429 ? COOLDOWN_MS.quota
    : status === 400 || status === 401 || status === 403 || status === 404 ? COOLDOWN_MS.rejected
    : COOLDOWN_MS.other;
  coolingUntil.set(target.id, now + ms);
}

export function resetPoolForTests(): void {
  coolingUntil.clear();
  rotation = 0;
}
