# Randevu backend'i

Proje: `yesil-veteriner` — `abdvslghmfanffaabkxp`.
Panel: https://supabase.com/dashboard/project/abdvslghmfanffaabkxp

## Akış

GitHub Pages'teki form → `submit-appointment` Edge Function → `public.appointment_requests`.
Formun sonucu yalnızca kayıt makbuzu doğrulandıktan sonra başarı sayılır. Randevu saati klinik tarafından ayrıca onaylanır.

- `supabase-config.js` yalnızca proje URL'si ve tarayıcıda kullanılabilen publishable key içerir. Servis anahtarı veya veritabanı şifresi buraya eklenmez.
- Ziyaretçiler ve normal Supabase Auth kullanıcıları tabloyu okuyamaz veya değiştiremez. Kayıt işlemi yalnızca sunucunun servis rolüne açık RPC üzerinden yapılır.
- Proje sahibi talepleri Supabase **Table Editor → public → appointment_requests** altında görebilir. Ayrı bir klinik yönetim ekranı veya e-posta bildirimi henüz yoktur.
- `status`: `new`, `contacted`, `confirmed`, `cancelled`, `completed`. `internal_note` klinik içi notlar içindir.
- Hatırlatma tercihi, zaman damgası ve metin sürümü kaydedilir. Otomatik SMS/WhatsApp/e-posta gönderilmez.
- Form geçersiz alanları, geçmiş tarihleri, 8 KB üzerindeki istekleri ve gizli bot alanını denetler. Sunucudaki telefon/IP ipucu bazlı HMAC anahtarları için 15 dakikada 5 talep sınırı uygulanır. IP ipucu tek başına güvenlik sınırı değildir; gelişmiş bot koruması veya CAPTCHA kurulmamıştır.
- Tarayıcı zaman aşımında aynı istek kimliğiyle tekrar dener. Sunucu aynı isteğe aynı kayıt kimliğini döndürür; çift kayıt oluşmaz. Kullanıcı yeni bilgilerle gönderirse yeni talep sayılır.

## Kaynaklar ve yayın

Resmi CLI sürümü: `supabase@2.122.0`. Migration dosyası CLI ile üretildi. İlk şema ve Edge Function yetkili Supabase panelinden kuruldu; yerel CLI'ye veritabanı şifresi/PAT kaydedilmedi. İleride CLI ile `db push` kullanmadan önce bu ilk şemanın migration geçmişiyle eşleştirilmesi gerekir; aynı `CREATE` ifadelerini tekrar çalıştırmayın.

Function bağımlılık içermez. Hosted runtime'ın `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY` değişkenlerini okur. Gizli değerler kaynak dosyalarına veya istemciye gönderilmez. Paneldeki mevcut legacy JWT doğrulaması korunmuştur; gerçek testte publishable key ile çağrı başarıyla doğrulanmıştır.

## Kontroller

```powershell
node tests/appointment-function.test.mjs
node tests/appointment-form.test.cjs
```

`supabase/tests/appointment_security.sql` proje SQL Editor'ında çalışır. Yetkileri, RLS'yi, aynı talebin tekrarını, hatırlatma tercihini ve hız sınırını kontrol eder; test kayıtlarını transaction sonunda geri alır.

`migrations/20261024132814_appointment_requests.sql` ilk şemadır. Değişiklik yaparken mevcut kayıtları koruyan yeni migration oluşturun. Sunucu kodu, istemci kodu ve Supabase izinlerini birlikte doğrulayın.
