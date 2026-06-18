// =====================================================================
// Mobil Uygulama Servis Katmanı - services/supabase.js
// React Native / Expo için. (@supabase/supabase-js + AsyncStorage)
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-url-polyfill/auto';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const API_BASE = 'https://ciftci-test.vercel.app/api';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ===================== AUTH =====================
export const auth = {
  // Kayıt — role: 'farmer' | 'customer'
  signUp: async ({ email, password, fullName, phone, role, farmName, city }) =>
    supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, phone, role, farm_name: farmName, city } },
    }),

  signIn: ({ email, password }) =>
    supabase.auth.signInWithPassword({ email, password }),

  signOut: () => supabase.auth.signOut(),

  getProfile: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return data;
  },
};

// ===================== ÜRÜNLER (Çiftçi CRUD) =====================
export const products = {
  // Herkes: aktif ürünleri listele (çiftçi bilgisi telefon HARİÇ gelir)
  list: ({ category, search } = {}) => {
    let q = supabase.from('products')
      .select('*, farmer:public_farmers!farmer_id(full_name, farm_name, city)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (category) q = q.eq('category', category);
    if (search) q = q.ilike('name', `%${search}%`);
    return q;
  },

  // Çiftçi: kendi ürünleri
  myProducts: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return supabase.from('products').select('*').eq('farmer_id', user.id)
      .order('created_at', { ascending: false });
  },

  create: async (p) => {
    const { data: { user } } = await supabase.auth.getUser();
    return supabase.from('products').insert({ ...p, farmer_id: user.id }).select().single();
  },

  update: (id, patch) =>
    supabase.from('products').update(patch).eq('id', id).select().single(),

  remove: (id) => supabase.from('products').delete().eq('id', id),
};

// ===================== SİPARİŞLER (Satın alma) =====================
const authHeader = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' };
};

export const orders = {
  // Müşteri: satın alma isteği gönder (Vercel API üzerinden)
  create: async ({ productId, quantity, note }) => {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ product_id: productId, quantity, note }),
    });
    return res.json();
  },

  // Müşteri siparişleri
  myOrders: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return supabase.from('orders')
      .select('*, product:products(name, unit, image_url)')
      .eq('customer_id', user.id).order('created_at', { ascending: false });
  },

  // Çiftçiye gelen siparişler (müşteri iletişimi kabul sonrası RPC ile açılır)
  incoming: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return supabase.from('orders')
      .select('*, product:products(name, unit)')
      .eq('farmer_id', user.id).order('created_at', { ascending: false });
  },

  // Çiftçi: kabul / red
  setStatus: (id, status) =>
    supabase.from('orders').update({ status }).eq('id', id).select().single(),

  // İletişim bilgisini al — YALNIZCA sipariş 'accepted' ise döner
  getContact: async (orderId) => {
    const { data, error } = await supabase.rpc('get_order_contact', {
      p_order_id: orderId,
    });
    if (error) return { error: error.message };
    return { contact: data?.[0] ?? null };
  },
};
