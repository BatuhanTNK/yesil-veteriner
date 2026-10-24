// Dependency-free Edge Function. Secrets stay in Supabase's runtime environment.
const ORIGINS = new Set(['https://batuhantnk.github.io', 'http://127.0.0.1:8000', 'http://localhost:8000']);
const TYPES = ['Genel randevu', 'Kontrol randevusu'];
const SPECIES = ['Kedi', 'Köpek', 'Kuş', 'Kemirgen', 'Diğer egzotik'];
const SERVICES = ['Muayene', 'Aşı', 'Cerrahi / kısırlaştırma', 'Laboratuvar', 'Beslenme danışmanlığı', 'Konaklama (hayvan oteli)', 'Acil durum', 'Diğer / emin değilim'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateRequest(raw, today) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RequestError('Form bilgileri geçersiz.');
  const text = (key, max, min = 0) => {
    const value = raw[key] ?? '';
    if (typeof value !== 'string') throw new RequestError('Form alanlarını kontrol edin.');
    const clean = value.trim().normalize('NFC');
    if (clean.length < min || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
      throw new RequestError('Form alanlarının uzunluğunu ve içeriğini kontrol edin.');
    }
    return clean;
  };
  if (text('website', 300)) throw new RequestError('Talep doğrulanamadı. Lütfen kliniği arayın.');
  const submissionKey = text('submissionKey', 36, 36);
  if (!UUID.test(submissionKey)) throw new RequestError('Talep kimliği geçersiz. Sayfayı yenileyin.');
  const name = text('name', 100, 2);
  const rawPhone = text('phone', 40, 10);
  if (!/^\+?[0-9\s().-]+$/.test(rawPhone)) throw new RequestError('Geçerli bir telefon numarası yazın.');
  const phone = rawPhone.replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]{10,15}$/.test(phone)) throw new RequestError('Geçerli bir telefon numarası yazın.');
  const appointment = text('appointment', 30);
  const species = text('species', 30);
  const service = text('service', 80);
  if (!TYPES.includes(appointment) || !SPECIES.includes(species) || !SERVICES.includes(service)) {
    throw new RequestError('Randevu türünü, hizmeti ve dostunuzun türünü kontrol edin.');
  }
  const date = text('date', 10);
  if (date) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today) {
      throw new RequestError('Bugün veya sonrası için geçerli bir tarih seçin.');
    }
  }
  if (typeof raw.reminder !== 'boolean') throw new RequestError('Hatırlatma tercihini kontrol edin.');
  return { submissionKey, appointment, name, phone, pet: text('pet', 80), species, date, service, notes: text('notes', 1500), reminder: raw.reminder };
}

async function limitedJSON(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Form bilgileri eksik.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new RequestError('Form içeriği çok uzun.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError('Form bilgileri geçersiz.'); }
}
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export function createHandler(options = {}) {
  const getEnv = options.getEnv || (name => Deno.env.get(name));
  const fetcher = options.fetch || fetch;
  const clock = options.now || (() => new Date());
  return async request => {
    const origin = request.headers.get('origin') || '';
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!ORIGINS.has(origin)) return reply({ ok: false, message: 'Bu kaynaktan talep kabul edilmiyor.' }, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'apikey, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ ok: false, message: 'Yalnızca form gönderimi destekleniyor.' }, 405);
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      return reply({ ok: false, message: 'Form biçimi geçersiz.' }, 415);
    }
    try {
      const keys = JSON.parse(getEnv('SUPABASE_PUBLISHABLE_KEYS') || '{}');
      const allowedKeys = new Set([...Object.values(keys), getEnv('SUPABASE_PUBLISHABLE_KEY'), getEnv('SUPABASE_ANON_KEY')].filter(Boolean));
      const serverKeys = JSON.parse(getEnv('SUPABASE_SECRET_KEYS') || '{}');
      const serverKey = serverKeys.default || getEnv('SUPABASE_SECRET_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY');
      const projectURL = getEnv('SUPABASE_URL');
      if (!projectURL || !serverKey || !allowedKeys.size) return reply({ ok: false, message: 'Randevu sistemi şu an kullanılamıyor. Lütfen kliniği arayın.' }, 503);
      if (!allowedKeys.has(request.headers.get('apikey'))) return reply({ ok: false, message: 'Form bağlantısı doğrulanamadı.' }, 401);
      const raw = await limitedJSON(request);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock());
      const data = validateRequest(raw, today);
      const payloadHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data))));
      const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(serverKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const fingerprint = async value => hex(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(value)));
      const rateKeys = [await fingerprint(`phone:${data.phone.replace(/\D/g, '')}`)];
      const ipHint = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
      if (ipHint) rateKeys.push(await fingerprint(`ip:${ipHint}`));
      const dbHeaders = { apikey: serverKey, 'Content-Type': 'application/json' };
      if (!serverKey.startsWith('sb_secret_')) dbHeaders.Authorization = `Bearer ${serverKey}`;
      const result = await fetcher(`${projectURL}/rest/v1/rpc/submit_appointment_request`, {
        method: 'POST', headers: dbHeaders,
        body: JSON.stringify({ p_request: data, p_payload_hash: payloadHash, p_rate_keys: rateKeys }),
        signal: AbortSignal.timeout(10000)
      });
      const body = await result.json();
      if (!result.ok) {
        if (body.message === 'RATE_LIMITED') {
          headers['Retry-After'] = '900';
          return reply({ ok: false, message: 'Kısa sürede çok sayıda talep geldi. Biraz sonra tekrar deneyin veya kliniği arayın.' }, 429);
        }
        if (body.message === 'SUBMISSION_CONFLICT') return reply({ ok: false, message: 'Talep bilgileri değişti. Sayfayı yenileyip tekrar deneyin.' }, 409);
        return reply({ ok: false, message: 'Talebinizin kaydedildiği doğrulanamadı. Tekrar deneyebilir veya kliniği arayabilirsiniz.' }, 503);
      }
      if (!body || !UUID.test(body.id)) throw new Error('Invalid database receipt');
      return reply({ ok: true, id: body.id }, 201);
    } catch (error) {
      if (error instanceof RequestError) return reply({ ok: false, message: error.message }, error.status);
      // Do not log names, telephone numbers, notes, request bodies or secrets.
      return reply({ ok: false, message: 'Talebinizin kaydedildiği doğrulanamadı. Lütfen tekrar deneyin veya kliniği arayın.' }, 503);
    }
  };
}
export default { fetch: createHandler() };
