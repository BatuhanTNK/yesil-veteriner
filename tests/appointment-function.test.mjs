import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../supabase/functions/submit-appointment/index.ts', import.meta.url), 'utf8');
const { createHandler, validateRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const receipt = '12345678-1234-4234-8234-123456789abc';
const sample = () => ({ submissionKey: 'a2345678-1234-4234-8234-123456789abc', name: 'Test Kullanıcısı', phone: '+90 (534) 000-00-00', pet: 'Test Dost', appointment: 'Kontrol randevusu', species: 'Kedi', service: 'Muayene', date: '2026-11-02', notes: 'Yalnızca otomatik test.', reminder: false, website: '' });
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_test' }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_only-on-server' }) };
function setup(response = { id: receipt, duplicate: false }, status = 200, variables = env) {
  const calls = [];
  const handle = createHandler({ getEnv: name => variables[name], now: () => new Date('2026-10-24T22:00:00Z'), fetch: async (url, options) => { calls.push({ url, options }); return Response.json(response, { status }); } });
  return { calls, handle };
}
function request(body = sample(), options = {}) {
  const headers = { origin: 'https://batuhantnk.github.io', apikey: 'sb_publishable_test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.2', ...options.headers };
  return new Request('https://example.supabase.co/functions/v1/submit-appointment', { method: options.method || 'POST', headers, ...(options.method === 'OPTIONS' || options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
test('saves a valid request and returns only a receipt', async () => {
  const { calls, handle } = setup(); const response = await handle(request());
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { ok: true, id: receipt });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://batuhantnk.github.io');
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.p_request.phone, '+905340000000'); assert.equal(sent.p_request.reminder, false);
  assert.equal(sent.p_rate_keys.length, 2);
  assert(sent.p_rate_keys.every(key => /^[a-f0-9]{64}$/.test(key)));
  assert(!JSON.stringify(sent.p_rate_keys).includes('203.0.113.2'));
  assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SECRET_KEYS ? 'sb_secret_only-on-server' : '');
});
test('a retry sends the same idempotency key and payload hash', async () => {
  const { calls, handle } = setup({ id: receipt, duplicate: true }); const data = sample();
  await handle(request(data)); await handle(request(data));
  assert.deepEqual(JSON.parse(calls[0].options.body), JSON.parse(calls[1].options.body));
});
test('rejects unauthorized origins and invalid keys without touching the database', async () => {
  const { calls, handle } = setup();
  assert.equal((await handle(request(sample(), { headers: { origin: 'https://untrusted.example' } }))).status, 403);
  assert.equal((await handle(request(sample(), { headers: { apikey: 'wrong' } }))).status, 401);
  assert.equal(calls.length, 0);
});
test('handles preflight, method and content type', async () => {
  const { handle, calls } = setup();
  assert.equal((await handle(request(null, { method: 'OPTIONS', headers: { apikey: '' } }))).status, 204);
  assert.equal((await handle(request(null, { method: 'GET' }))).status, 405);
  assert.equal((await handle(request(sample(), { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal(calls.length, 0);
});
test('rejects honeypots, invalid dates, malformed JSON and oversized bodies', async () => {
  const { handle, calls } = setup();
  for (const change of [{ website: 'spam' }, { date: '2026-02-30' }, { date: '2026-10-24' }, { phone: 'not-a-number' }, { service: 'unknown' }, { reminder: 'yes' }, { name: 'X' }]) {
    assert.equal((await handle(request({ ...sample(), ...change }))).status, 400);
  }
  assert.equal((await handle(request('{bad-json'))).status, 400);
  assert.equal((await handle(request('x'.repeat(9000)))).status, 413);
  assert.equal(calls.length, 0);
});
test('uses Istanbul date and allows same-day requests', () => {
  assert.equal(validateRequest({ ...sample(), date: '2026-10-25' }, '2026-10-25').date, '2026-10-25');
});
test('maps rate limiting and conflicts without leaking database messages', async () => {
  const limited = setup({ message: 'RATE_LIMITED' }, 400);
  const rateResponse = await limited.handle(request()); assert.equal(rateResponse.status, 429); assert.equal(rateResponse.headers.get('retry-after'), '900');
  const conflict = setup({ message: 'SUBMISSION_CONFLICT' }, 400); assert.equal((await conflict.handle(request())).status, 409);
  const failed = setup({ message: 'private database error with internals' }, 500);
  const response = await failed.handle(request()); assert.equal(response.status, 503); assert(!JSON.stringify(await response.json()).includes('private database'));
});
test('fails closed without server configuration and never reports invalid receipts as success', async () => {
  assert.equal((await setup({}, 200, {}).handle(request())).status, 503);
  assert.equal((await setup({ id: 'not-a-receipt' }).handle(request())).status, 503);
});
