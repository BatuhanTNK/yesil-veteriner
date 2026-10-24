const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../appointment-form.js'), 'utf8');
const receipt = '12345678-1234-4234-8234-123456789abc';
function setup(fetcher, search = '') {
  const field = (value, options) => ({ value, disabled: false, options: (options || []).map(value => ({ value })) });
  const elements = {
    appointment: field('Genel randevu', ['Genel randevu', 'Kontrol randevusu']),
    service: field('Muayene', ['Muayene', 'Aşı', 'Beslenme danışmanlığı']),
    name: field('Teknik Test'), phone: field('05000000000'), pet: field('Test Dost'), species: field('Kedi'), date: field(''), notes: field('TEST'), website: field(''), reminder: { checked: false, disabled: false }
  };
  elements[Symbol.iterator] = function* () { yield* Object.values(elements); };
  const events = {}, controlClicks = [];
  const message = { textContent: '' }, fallback = { hidden: true }, status = { hidden: true, dataset: {}, querySelector: selector => selector === '.ct-status-message' ? message : fallback };
  const label = { textContent: 'Randevu talebi gönder' };
  const button = { disabled: false, querySelector: () => label };
  const attributes = {};
  let valid = true, reports = 0;
  const form = { elements, checkValidity: () => valid, reportValidity: () => reports++, addEventListener: (name, fn) => events[name] = fn, querySelector: selector => selector === '.ct-status' ? status : button, setAttribute: (key, value) => attributes[key] = value, removeAttribute: key => delete attributes[key] };
  const calls = [];
  vm.runInNewContext(source, {
    document: { querySelector: () => form, querySelectorAll: () => [{ dataset: { appointment: 'Kontrol randevusu' }, addEventListener: (_, fn) => controlClicks.push(fn) }] },
    window: { location: { search }, YESIL_SUPABASE: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', functionName: 'submit-appointment' } },
    fetch: async (...args) => { calls.push(args); return fetcher(...args); }, crypto, URLSearchParams, Intl, Date, AbortController, setTimeout, clearTimeout, TypeError
  });
  return { elements, events, message, fallback, status, button, label, attributes, calls, controlClicks, invalid: () => valid = false, reports: () => reports, submit: () => events.submit({ preventDefault() {} }) };
}
const success = () => Response.json({ ok: true, id: receipt }, { status: 201 });
test('deep links preserve service and follow-up choices; reminder remains opt-in', () => {
  const s = setup(success, '?hizmet=A%C5%9F%C4%B1&randevu=kontrol');
  assert.equal(s.elements.service.value, 'Aşı'); assert.equal(s.elements.appointment.value, 'Kontrol randevusu'); assert.equal(s.elements.reminder.checked, false);
});
test('success sends the selected preference, preserves inputs and prevents another identical submit', async () => {
  const s = setup(success); s.elements.reminder.checked = true; await s.submit();
  assert.equal(s.status.dataset.state, 'success'); assert.equal(s.fallback.hidden, true); assert.equal(s.button.disabled, true);
  assert.equal(s.elements.name.value, 'Teknik Test'); assert.equal(JSON.parse(s.calls[0][1].body).reminder, true);
  await s.submit(); assert.equal(s.calls.length, 1);
});
test('submission disables input, blocks parallel submits and then restores editable fields', async () => {
  let finish; const s = setup(() => new Promise(resolve => finish = resolve)); const pending = s.submit();
  assert.equal(s.attributes['aria-busy'], 'true'); assert.equal(s.elements.name.disabled, true); await s.submit(); assert.equal(s.calls.length, 1);
  finish(success()); await pending; assert.equal(s.elements.name.disabled, false); assert(!('aria-busy' in s.attributes));
});
test('an uncertain network failure is not success; retry reuses its idempotency key', async () => {
  let count = 0; const s = setup(() => ++count === 1 ? Promise.reject(new TypeError('network down')) : success());
  await s.submit(); assert.equal(s.status.dataset.state, 'error'); assert.equal(s.elements.name.value, 'Teknik Test'); assert.equal(s.fallback.hidden, false); assert.equal(s.button.disabled, false);
  await s.submit(); assert.equal(s.status.dataset.state, 'success');
  assert.equal(JSON.parse(s.calls[0][1].body).submissionKey, JSON.parse(s.calls[1][1].body).submissionKey);
});
test('a changed form creates a new request rather than reusing the earlier key', async () => {
  const s = setup(success); await s.submit(); s.elements.notes.value = 'Changed'; s.events.input(); await s.submit();
  assert.notEqual(JSON.parse(s.calls[0][1].body).submissionKey, JSON.parse(s.calls[1][1].body).submissionKey);
});
test('invalid forms do not contact the backend', async () => {
  const s = setup(success); s.invalid(); await s.submit(); assert.equal(s.calls.length, 0); assert.equal(s.reports(), 1);
});
test('rate limit and malformed server responses cannot display a success state', async () => {
  const limited = setup(() => Response.json({ ok: false, message: 'Biraz sonra tekrar deneyin.' }, { status: 429 })); await limited.submit(); assert.equal(limited.status.dataset.state, 'error');
  const malformed = setup(() => new Response('<html>proxy error</html>', { status: 502 })); await malformed.submit(); assert.equal(malformed.status.dataset.state, 'error'); assert(!malformed.message.textContent.includes('Unexpected token'));
});
