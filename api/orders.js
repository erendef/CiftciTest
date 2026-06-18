// =====================================================================
// Vercel Serverless Function - api/orders.js
// Mevcut vercel_test projene eklenebilir.
// Supabase service role ile güvenli sipariş işlemleri yürütür.
// =====================================================================
import { createClient } from '@supabase/supabase-js';

// Env vars (Vercel dashboard > Settings > Environment Variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (gizli, sadece sunucuda)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Kullanıcının JWT'sini al ve doğrula
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } =
    await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Yetkisiz' });

  // ---- POST: satın alma isteği oluştur ----
  if (req.method === 'POST') {
    const { product_id, quantity, note } = req.body;

    const { data: product, error: pErr } = await supabaseAdmin
      .from('products').select('*').eq('id', product_id).single();
    if (pErr || !product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    if (product.stock < quantity)
      return res.status(400).json({ error: 'Yetersiz stok' });

    const { data: order, error: oErr } = await supabaseAdmin
      .from('orders')
      .insert({
        product_id,
        customer_id: user.id,
        farmer_id: product.farmer_id,
        quantity,
        total_price: product.price * quantity,
        note,
      })
      .select()
      .single();
    if (oErr) return res.status(400).json({ error: oErr.message });
    return res.status(201).json({ order });
  }

  // ---- GET: çiftçi numarasını getir (sadece kabul edilmiş sipariş için) ----
  if (req.method === 'GET') {
    const { order_id } = req.query;
    const { data: order } = await supabaseAdmin
      .from('orders').select('*').eq('id', order_id).single();

    // İletişim bilgisi sadece taraflara açılır
    const isParty = order &&
      (order.customer_id === user.id || order.farmer_id === user.id);
    if (!isParty) return res.status(403).json({ error: 'Erişim yok' });

    // Telefon numarası YALNIZCA çiftçi siparişi kabul ettikten sonra görünür
    if (order.status !== 'accepted')
      return res.status(403).json({
        error: 'İletişim bilgisi sipariş kabul edildikten sonra açılır',
        status: order.status,
      });

    const { data: farmer } = await supabaseAdmin
      .from('profiles')
      .select('full_name, phone, farm_name')
      .eq('id', order.farmer_id).single();

    return res.status(200).json({ contact: farmer });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
