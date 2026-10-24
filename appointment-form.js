(() => {
  const form = document.querySelector('#contact form');
  if (!form) return;
  const status = form.querySelector('.ct-status');
  const message = status.querySelector('.ct-status-message');
  const fallback = status.querySelector('.ct-whatsapp-link');
  const button = form.querySelector('button[type="submit"]');
  const buttonLabel = button.querySelector('span');
  const fields = Array.from(form.elements).filter(field => field !== button);
  const config = window.YESIL_SUPABASE;
  let busy = false, lastSignature = '', submissionKey = '', completedSignature = '';
  const changed = () => {
    status.hidden = true;
    if (!busy) { button.disabled = false; buttonLabel.textContent = 'Randevu talebi gönder'; }
  };
  const choose = (name, value) => {
    if (busy) return;
    const field = form.elements[name];
    if (Array.from(field.options).some(option => option.value === value)) { field.value = value; changed(); }
  };
  const params = new URLSearchParams(window.location.search);
  if (params.has('hizmet')) choose('service', params.get('hizmet'));
  if (params.get('randevu') === 'kontrol') choose('appointment', 'Kontrol randevusu');
  document.querySelectorAll('[data-appointment]').forEach(link => link.addEventListener('click', () => choose('appointment', link.dataset.appointment)));
  form.elements.date.min = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  const value = name => (form.elements[name]?.value || '').trim();
  function whatsappURL(data) {
    const date = data.date ? data.date.split('-').reverse().join('.') : '-';
    const lines = ['Merhaba, Yeşil Veteriner web sitesinden randevu talebi:', `Randevu türü: ${data.appointment}`, `Ad soyad: ${data.name}`, `Telefon: ${data.phone}`, `Dostumuz: ${data.pet || '-'} (${data.species})`, `Hizmet: ${data.service}`, `Tercih edilen tarih: ${date}`];
    if (data.notes) lines.push(`Not: ${data.notes}`);
    lines.push(data.reminder ? 'Kontrol zamanı için telefon veya WhatsApp üzerinden benimle iletişime geçilmesini istiyorum.' : 'Kontrol hatırlatması istemiyorum.');
    return `https://wa.me/905342000838?text=${encodeURIComponent(lines.join('\n'))}`;
  }
  const show = (text, failed) => {
    message.textContent = text;
    fallback.hidden = !failed;
    status.dataset.state = failed ? 'error' : 'success';
    status.hidden = false;
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = { appointment: value('appointment'), name: value('name'), phone: value('phone'), pet: value('pet'), species: value('species'), date: value('date'), service: value('service'), notes: value('notes'), reminder: form.elements.reminder.checked, website: value('website') };
    const signature = JSON.stringify(data);
    if (signature === completedSignature) { show('Bu talebiniz alındı. Randevu gün ve saatini klinik sizinle netleştirecek.', false); button.disabled = true; return; }
    if (signature !== lastSignature) { submissionKey = crypto.randomUUID(); lastSignature = signature; }
    fallback.href = whatsappURL(data);
    if (!config?.url?.startsWith('https://') || !config.publishableKey?.startsWith('sb_publishable_')) {
      show('Randevu bağlantısı şu an kullanılamıyor. Kliniği arayabilir veya WhatsApp üzerinden yazabilirsiniz.', true); return;
    }
    busy = true;
    fields.forEach(field => { field.disabled = true; });
    button.disabled = true;
    buttonLabel.textContent = 'Gönderiliyor…';
    form.setAttribute('aria-busy', 'true');
    status.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${config.url}/functions/v1/${config.functionName}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey }, body: JSON.stringify({ ...data, submissionKey }), signal: controller.signal });
      let result;
      try { result = await response.json(); }
      catch { throw new Error('Talebinizin kaydedildiği doğrulanamadı. Lütfen tekrar deneyin veya kliniğe ulaşın.'); }
      if (!response.ok || result.ok !== true || !/^[0-9a-f-]{36}$/i.test(result.id || '')) {
        throw new Error(response.status === 400 || response.status === 429 ? result.message : 'Talebinizin kaydedildiği doğrulanamadı. Tekrar deneyebilir veya kliniğe doğrudan ulaşabilirsiniz.');
      }
      completedSignature = signature;
      show('Talebiniz alındı. Randevu gün ve saatini netleştirmek için klinik sizinle iletişime geçecek. Acil durumlarda lütfen arayın.', false);
      buttonLabel.textContent = 'Talep alındı';
    } catch (error) {
      show(error.name === 'AbortError' || error instanceof TypeError ? 'Bağlantı nedeniyle kayıt sonucu doğrulanamadı. Bilgileriniz korunuyor; tekrar deneyebilir veya WhatsApp üzerinden yazabilirsiniz.' : error.message, true);
      buttonLabel.textContent = 'Tekrar dene';
    } finally {
      clearTimeout(timeout);
      busy = false;
      fields.forEach(field => { field.disabled = false; });
      form.removeAttribute('aria-busy');
      button.disabled = completedSignature === JSON.stringify({ appointment: value('appointment'), name: value('name'), phone: value('phone'), pet: value('pet'), species: value('species'), date: value('date'), service: value('service'), notes: value('notes'), reminder: form.elements.reminder.checked, website: value('website') });
    }
  });
})();
