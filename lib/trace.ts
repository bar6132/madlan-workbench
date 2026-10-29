import { randomBytes } from 'node:crypto';

const FORBIDDEN_KEYS = ['message', 'customer_message', 'reply_text'];

export function newTraceId(): string {
  return `trc_${randomBytes(4).toString('hex')}`;
}

/** One structured JSON line per event; never the customer's text. */
export function logEvent(e: Record<string, unknown>): void {
  for (const k of FORBIDDEN_KEYS) {
    if (k in e) throw new Error(`logEvent: key "${k}" is not allowed in logs`);
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...e }));
}
