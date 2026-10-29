import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { generateJson, setProviderForTests } from '@/lib/llm';

const schema = z.object({ answer: z.string() });
const call = (extra: object = {}) => generateJson({ system: 's', prompt: 'p', schema, timeoutMs: 100, ...extra });

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
});
afterEach(() => {
  setProviderForTests(null);
  delete process.env.GEMINI_API_KEY;
});

test('success parses and validates provider output', async () => {
  setProviderForTests(async () => '{"answer":"שלום"}');
  const r = await call();
  expect(r).toMatchObject({ ok: true, data: { answer: 'שלום' } });
});

test('JSON wrapped in a code fence is accepted', async () => {
  setProviderForTests(async () => '```json\n{"answer":"x"}\n```');
  expect((await call()).ok).toBe(true);
});

test('a provider that hangs yields TIMEOUT within the timeout window', async () => {
  setProviderForTests(() => new Promise(() => {}));
  const t0 = Date.now();
  const r = await call();
  expect(r).toMatchObject({ ok: false, reason: 'TIMEOUT' });
  expect(Date.now() - t0).toBeLessThan(400);
});

test('a throwing provider is retried once, then PROVIDER_ERROR', async () => {
  const fn = vi.fn(async () => {
    throw new Error('boom');
  });
  setProviderForTests(fn);
  const r = await call();
  expect(r).toMatchObject({ ok: false, reason: 'PROVIDER_ERROR' });
  expect(fn).toHaveBeenCalledTimes(2);
});

test('non-JSON and schema-invalid outputs are INVALID_JSON without retry', async () => {
  const fn = vi.fn(async () => 'not json');
  setProviderForTests(fn);
  expect(await call()).toMatchObject({ ok: false, reason: 'INVALID_JSON' });
  expect(fn).toHaveBeenCalledTimes(1);
  setProviderForTests(async () => '{"other":1}');
  expect(await call()).toMatchObject({ ok: false, reason: 'INVALID_JSON' });
});

test('missing key yields NO_KEY', async () => {
  delete process.env.GEMINI_API_KEY;
  expect(await call()).toMatchObject({ ok: false, reason: 'NO_KEY' });
});

test('simulate maps to reasons without calling the provider', async () => {
  const fn = vi.fn(async () => '{"answer":"x"}');
  setProviderForTests(fn);
  expect(await call({ simulate: 'TIMEOUT' })).toMatchObject({ ok: false, reason: 'TIMEOUT' });
  expect(await call({ simulate: 'PROVIDER_ERROR' })).toMatchObject({ ok: false, reason: 'PROVIDER_ERROR' });
  expect(await call({ simulate: 'INVALID_JSON' })).toMatchObject({ ok: false, reason: 'INVALID_JSON' });
  expect(fn).not.toHaveBeenCalled();
  expect((await call({ simulate: 'NONE' })).ok).toBe(true);
});
