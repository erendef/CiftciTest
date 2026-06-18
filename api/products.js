import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ---- GET: herkese açık ürün listesi (login gerekmez) ----
  if (req.method === 'GET') {
    const { category, search, id } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('*, farmer:profiles!farmer_id(full_name, farm_name, city)')
        .eq('id', id)
        .eq('is_active', true)
        .single();
      if (error) return res.status(404).json({ error: 'Ürün bulunamadı' });
      return res.status(200).json({ product: data });
    }

    let q = supabaseAdmin
      .from('products')
      .select('*, farmer:profiles!farmer_id(full_name, farm_name, city)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (category) q = q.eq('category', category);
    if (search) q = q.ilike('name', `%${search}%`);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ products: data });
  }

  // Aşağıdaki işlemler için login zorunlu
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Yetkisiz' });

  // Çiftçi kontrolü
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single();
  const isFarmer = profile?.role === 'farmer';

  // ---- POST: ürün ekle (sadece çiftçi) ----
  if (req.method === 'POST') {
    if (!isFarmer) return res.status(403).json({ error: 'Sadece çiftçiler ürün ekleyebilir' });

    const { name, description, category, unit, price, stock, image_url } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name ve price zorunlu' });

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({ name, description, category, unit: unit || 'kg', price, stock: stock || 0, image_url, farmer_id: user.id })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ product: data });
  }

  // ---- PUT: ürün güncelle (sadece kendi ürünü) ----
  if (req.method === 'PUT') {
    if (!isFarmer) return res.status(403).json({ error: 'Sadece çiftçiler ürün güncelleyebilir' });

    const { id, ...patch } = req.body;
    if (!id) return res.status(400).json({ error: 'id zorunlu' });

    const { data: existing } = await supabaseAdmin
      .from('products').select('farmer_id').eq('id', id).single();
    if (existing?.farmer_id !== user.id) return res.status(403).json({ error: 'Bu ürün size ait değil' });

    const { data, error } = await supabaseAdmin
      .from('products').update(patch).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ product: data });
  }

  // ---- DELETE: ürün sil (sadece kendi ürünü) ----
  if (req.method === 'DELETE') {
    if (!isFarmer) return res.status(403).json({ error: 'Sadece çiftçiler ürün silebilir' });

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id zorunlu' });

    const { data: existing } = await supabaseAdmin
      .from('products').select('farmer_id').eq('id', id).single();
    if (existing?.farmer_id !== user.id) return res.status(403).json({ error: 'Bu ürün size ait değil' });

    const { error } = await supabaseAdmin.from('products').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
