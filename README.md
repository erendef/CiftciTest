# Yerel Çiftçi Pazarı — Backend

Supabase (auth + Postgres + RLS) ve Vercel (serverless API) üzerine kurulu backend.

## Klasör yapısı

```
farmer_market/
├── api/
│   └── orders.js          # Vercel serverless fonksiyonu (sipariş + iletişim)
├── services/
│   └── supabase.js        # Mobil uygulama servis katmanı (Expo / React Native)
├── supabase/
│   └── schema.sql         # Veritabanı şeması, trigger'lar, RLS, RPC
├── package.json
├── vercel.json
└── .env.example
```

## Kurulum

1. **Veritabanı**: `supabase/schema.sql` içeriğini Supabase > SQL Editor'a yapıştır ve çalıştır.
2. **Auth**: Supabase > Authentication > Providers'tan Email'i aç.
3. **Vercel**: `api/` ve config dosyalarını projene koy, deploy et. Ortam değişkenlerini
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) Vercel dashboard'dan gir.
4. **Mobil**: `services/supabase.js` dosyasını Expo projene ekle, `EXPO_PUBLIC_*`
   değişkenlerini tanımla. Bağımlılıklar: `@supabase/supabase-js`,
   `@react-native-async-storage/async-storage`, `react-native-url-polyfill`.

## Roller ve akış

- **Çiftçi** (`farmer`): ürünler üzerinde tam CRUD yapar.
- **Müşteri** (`customer`): aktif ürünleri görür, satın alma isteği gönderir.
- Çiftçi siparişi **kabul edince** stok düşer ve telefon numarası açılır.
- Telefon numarası yalnızca `get_order_contact` RPC'si üzerinden, sipariş
  `accepted` durumundaysa ve çağıran kişi siparişin tarafıysa döner.

## Güvenlik notu

`service_role` anahtarı yalnızca Vercel sunucu ortamında bulunmalı; mobil
uygulamaya asla gömülmemeli. Mobil taraf yalnızca `anon` anahtarı kullanır,
RLS politikaları erişimi sınırlar.
