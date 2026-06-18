-- =====================================================================
-- YEREL ÇİFTÇİ PAZARI - Supabase Backend Schema
-- =====================================================================
-- Roller: 'farmer' (çiftçi) ve 'customer' (kullanıcı)
-- Akış: Çiftçi ürün ekler -> Kullanıcı görür -> Satın alma isteği gönderir
--       -> Çiftçi telefon üzerinden iletişime geçer
-- =====================================================================

-- ---------- ENUM TÜRLERİ ----------
create type user_role as enum ('farmer', 'customer');
create type order_status as enum ('pending', 'accepted', 'rejected', 'completed', 'cancelled');

-- =====================================================================
-- PROFILES (auth.users ile 1-1 ilişkili)
-- =====================================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text not null,                 -- iletişim için telefon
  role        user_role not null default 'customer',
  farm_name   text,                          -- sadece çiftçiler için
  city        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- PRODUCTS (çiftçilerin ürünleri)
-- =====================================================================
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  farmer_id   uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  description text,
  category    text,                          -- sebze, meyve, süt ürünü vb.
  unit        text not null default 'kg',    -- kg, adet, demet
  price       numeric(10,2) not null check (price >= 0),
  stock       numeric(10,2) not null default 0 check (stock >= 0),
  image_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_products_farmer on public.products(farmer_id);
create index idx_products_active on public.products(is_active) where is_active = true;

-- =====================================================================
-- ORDERS (satın alma istekleri)
-- =====================================================================
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  farmer_id    uuid not null references public.profiles(id) on delete cascade,
  quantity     numeric(10,2) not null check (quantity > 0),
  total_price  numeric(10,2) not null check (total_price >= 0),
  note         text,
  status       order_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_orders_customer on public.orders(customer_id);
create index idx_orders_farmer on public.orders(farmer_id);

-- =====================================================================
-- TRIGGER: yeni kullanıcı kaydolunca profil oluştur
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, farm_name, city)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer'),
    new.raw_user_meta_data->>'farm_name',
    new.raw_user_meta_data->>'city'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- TRIGGER: updated_at otomatik güncelleme
-- =====================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger trg_orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- TRIGGER: sipariş kabul edilince stoğu düş
-- =====================================================================
create or replace function public.handle_order_accept()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    update public.products
      set stock = stock - new.quantity
      where id = new.product_id;
  end if;
  return new;
end;
$$;

create trigger trg_order_accept after update on public.orders
  for each row execute function public.handle_order_accept();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- ---- PROFILES politikaları ----
-- Kullanıcılar kendi profilini görür. Çiftçi adı/çiftlik adı gibi
-- herkese açık alanlar ürün sorgusunda join ile gelir (telefon HARİÇ).
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Ürün listelemede çiftçinin halka açık bilgilerini (telefon olmadan)
-- döndüren güvenli view
create view public.public_farmers
  with (security_invoker = true) as
  select id, full_name, farm_name, city
  from public.profiles where role = 'farmer';

-- İletişim bilgisini (telefon) YALNIZCA kabul edilmiş siparişin
-- tarafına döndüren güvenli fonksiyon
create or replace function public.get_order_contact(p_order_id uuid)
returns table (full_name text, phone text, farm_name text)
language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order is null then raise exception 'Sipariş bulunamadı'; end if;
  if auth.uid() <> v_order.customer_id and auth.uid() <> v_order.farmer_id then
    raise exception 'Erişim yok';
  end if;
  if v_order.status <> 'accepted' then
    raise exception 'İletişim bilgisi sipariş kabul edildikten sonra açılır';
  end if;
  return query
    select p.full_name, p.phone, p.farm_name
    from public.profiles p where p.id = v_order.farmer_id;
end;
$$;

-- ---- PRODUCTS politikaları ----
-- Aktif ürünleri herkes görebilir
create policy "products_select_active" on public.products
  for select using (is_active = true or farmer_id = auth.uid());

-- Sadece çiftçi kendi ürününü ekler
create policy "products_insert_farmer" on public.products
  for insert with check (
    farmer_id = auth.uid()
    and exists (select 1 from public.profiles
                where id = auth.uid() and role = 'farmer')
  );

-- Çiftçi sadece kendi ürününü günceller/siler (CRUD)
create policy "products_update_own" on public.products
  for update using (farmer_id = auth.uid());

create policy "products_delete_own" on public.products
  for delete using (farmer_id = auth.uid());

-- ---- ORDERS politikaları ----
-- Müşteri kendi siparişini, çiftçi kendine gelen siparişi görür
create policy "orders_select_involved" on public.orders
  for select using (customer_id = auth.uid() or farmer_id = auth.uid());

-- Sadece müşteri satın alma isteği gönderir
create policy "orders_insert_customer" on public.orders
  for insert with check (
    customer_id = auth.uid()
    and exists (select 1 from public.profiles
                where id = auth.uid() and role = 'customer')
  );

-- Çiftçi siparişin durumunu günceller (kabul/red), müşteri iptal edebilir
create policy "orders_update_involved" on public.orders
  for update using (farmer_id = auth.uid() or customer_id = auth.uid());
