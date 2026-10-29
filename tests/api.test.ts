import { test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/analyze', async (orig) => ({ ...(await orig<typeof import('@/lib/analyze')>()), analyze: vi.fn() }));

import { analyze } from '@/lib/analyze';
import { POST } from '@/app/api/analyze/route';
import { resetRateLimitForTests } from '@/lib/rate-limit';

const mocked = vi.mocked(analyze);
const fakeResult = { trace_id: 'trc_test', state: 'RESOLVED' };

function req(body: unknown, opts: { ip?: string; debug?: boolean; raw?: string } = {}) {
  return new Request(`http://localhost/api/analyze${opts.debug ? '?debug=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? '1.1.1.1' },
    body: opts.raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimitForTests();
  mocked.mockReset();
  mocked.mockResolvedValue(fakeResult as never);
});

test('a valid request returns the analysis with HTTP 200', async () => {
  const res = await POST(req({ message: 'שלום D100124' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject(fakeResult);
});

test('the 16th request within a minute from one IP is rate limited; another IP is unaffected', async () => {
  for (let i = 0; i < 15; i++) expect((await POST(req({ message: 'x' }))).status).toBe(200);
  const limited = await POST(req({ message: 'x' }));
  expect(limited.status).toBe(429);
  const body = await limited.json();
  expect(body.state).toBe('RATE_LIMITED');
  expect(body.notices_he.length).toBeGreaterThan(0);
  expect(body.trace_id).toMatch(/^trc_/);
  expect((await POST(req({ message: 'x' }, { ip: '2.2.2.2' }))).status).toBe(200);
});

test('a non-JSON body is a 400, not a crash', async () => {
  const res = await POST(req(null, { raw: 'not json' }));
  expect(res.status).toBe(400);
  expect((await res.json()).state).toBe('ERROR');
});

test('a body that fails validation is a 400', async () => {
  expect((await POST(req({ message: 12345 }))).status).toBe(400);
});

test('an internal error returns a safe 500 with no stack or error text', async () => {
  mocked.mockRejectedValue(new Error('secret internal detail at C:\\app\\file.ts'));
  const res = await POST(req({ message: 'x' }));
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).not.toContain('secret internal detail');
  expect(text).not.toContain('stack');
  expect(JSON.parse(text)).toMatchObject({ state: 'ERROR' });
  expect(JSON.parse(text).trace_id).toMatch(/^trc_/);
});

test('simulate flags are ignored without ?debug=1 and honoured with it', async () => {
  await POST(req({ message: 'x', simulate: 'TIMEOUT', simulate_reply: 'INVALID_JSON' }));
  expect(mocked.mock.calls[0][0]).toMatchObject({ simulate: undefined, simulate_reply: undefined });
  await POST(req({ message: 'x', simulate: 'TIMEOUT', simulate_reply: 'INVALID_JSON' }, { debug: true }));
  expect(mocked.mock.calls[1][0]).toMatchObject({ simulate: 'TIMEOUT', simulate_reply: 'INVALID_JSON' });
});
