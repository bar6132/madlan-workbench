// Best-effort only: state is per serverless instance and resets on cold start.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;

const hits = new Map<string, number[]>();

export function rateLimit(ip: string, now: number = Date.now()): { allowed: boolean } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(ip, recent);
    return { allowed: false };
  }
  recent.push(now);
  hits.set(ip, recent);
  return { allowed: true };
}

export function resetRateLimitForTests(): void {
  hits.clear();
}
