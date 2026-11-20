-- =====================================================================
-- DevBurguer - banco de dados de pedidos (Supabase / Postgres)
--
-- Como usar: Supabase > SQL Editor > New query > cole TUDO > Run.
-- Pode rodar de novo sem problema (ele atualiza o que já existe).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

-- Cardápio (a fonte de verdade dos preços: o servidor usa estes valores)
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  description text,
  price       numeric(10,2) not null check (price >= 0),
  active      boolean not null default true
);

-- Configurações da loja (uma única linha)
create table if not exists public.settings (
  id           int primary key default 1 check (id = 1),
  delivery_fee numeric(10,2) not null default 6.00 check (delivery_fee >= 0)
);

insert into public.settings (id, delivery_fee)
values (1, 6.00)
on conflict (id) do nothing;

-- Pedidos
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  number         int generated always as identity (start with 1001),
  created_at     timestamptz not null default now(),
  status         text not null default 'received'
                 check (status in ('received','preparing','ready','out_for_delivery','delivered','cancelled')),
  payment_status text not null default 'pending'
                 check (payment_status in ('pending','paid')),
  customer_name  text not null,
  customer_phone text not null,
  mode           text not null check (mode in ('delivery','pickup')),
  address        text,
  payment_method text not null check (payment_method in ('pix','card','cash')),
  card_type      text check (card_type in ('crédito','débito')),
  change_for     numeric(10,2),
  subtotal       numeric(10,2) not null,
  delivery_fee   numeric(10,2) not null,
  total          numeric(10,2) not null
);

create unique index if not exists orders_number_idx on public.orders (number);
create index if not exists orders_created_idx on public.orders (created_at desc);

-- Itens de cada pedido (guarda nome e preço no momento da compra)
create table if not exists public.order_items (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id),
  name       text not null,
  unit_price numeric(10,2) not null,
  qty        int not null check (qty between 1 and 50)
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- Quem pode usar o painel da cozinha
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);


-- ---------------------------------------------------------------------
-- 2. CARDÁPIO INICIAL
--    Mantenha os ids e preços IGUAIS aos do produtos.js do site.
-- ---------------------------------------------------------------------
insert into public.products (id, name, description, price) values
  ('x-burguer',     'X-Burguer',       'Pão brioche, hamburguer 180g, queijo cheddar, alface, tomate e molho especial', 29.90),
  ('x-bacon',       'X - Bacon',       'Pão brioche, hamburguer 180g, queijo cheddar, bacon, alface, tomate e molho especial', 32.90),
  ('bacon-duplo',   'Bacon duplo',     'Pão brioche, dois hamburgueres 180g, queijo cheddar, bacon, alface, tomate e molho especial', 35.90),
  ('porcao-batata', 'Porção de fritas','Batata frita 300g', 22.90),
  ('coca-cola-350', 'Coca Cola',       'Coca Cola 350ml', 8.90),
  ('milkshake',     'MilkShake',       'MilkShake com várias opções de sabores', 23.90)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      price = excluded.price;


-- ---------------------------------------------------------------------
-- 3. SEGURANÇA (RLS)
--    Cliente (anônimo): só lê o cardápio e cria pedidos pela função create_order.
--    Equipe (logada e listada em "admins"): lê pedidos e muda o status.
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.products    enable row level security;
alter table public.settings    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.admins      enable row level security;

drop policy if exists "cardapio publico"   on public.products;
drop policy if exists "config publica"     on public.settings;
drop policy if exists "admin le pedidos"   on public.orders;
drop policy if exists "admin muda pedidos" on public.orders;
drop policy if exists "admin le itens"     on public.order_items;
drop policy if exists "admin se le"        on public.admins;

create policy "cardapio publico" on public.products
  for select to anon, authenticated using (active);

create policy "config publica" on public.settings
  for select to anon, authenticated using (true);

create policy "admin le pedidos" on public.orders
  for select to authenticated using (public.is_admin());

create policy "admin muda pedidos" on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin le itens" on public.order_items
  for select to authenticated using (public.is_admin());

create policy "admin se le" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Permissões das tabelas: começa tirando tudo e libera só o necessário
revoke all on public.products, public.settings, public.orders,
              public.order_items, public.admins from anon, authenticated;

grant select on public.products, public.settings to anon, authenticated;
grant select on public.orders, public.order_items, public.admins to authenticated;
grant update (status, payment_status) on public.orders to authenticated;


-- ---------------------------------------------------------------------
-- 4. FUNÇÃO create_order: o único jeito de um cliente criar um pedido
--    Recebe só ids e quantidades, busca os preços no banco e calcula o total.
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_name  text,
  p_customer_phone text,
  p_mode           text,
  p_address        text,
  p_payment_method text,
  p_card_type      text,
  p_change_for     numeric,
  p_items          jsonb,
  p_expected_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name     text := trim(coalesce(p_customer_name, ''));
  v_phone    text := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  v_address  text := nullif(trim(coalesce(p_address, '')), '');
  v_subtotal numeric(10,2) := 0;
  v_fee      numeric(10,2) := 0;
  v_total    numeric(10,2);
  v_found    int;
  v_distinct int;
  v_order    public.orders%rowtype;
begin
  -- Dados do cliente
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'DADOS_INVALIDOS: nome';
  end if;

  if char_length(v_phone) < 10 or char_length(v_phone) > 11 then
    raise exception 'DADOS_INVALIDOS: telefone';
  end if;

  if coalesce(p_mode, '') not in ('delivery', 'pickup') then
    raise exception 'DADOS_INVALIDOS: modo';
  end if;

  if p_mode = 'delivery'
     and (v_address is null or char_length(v_address) < 5 or char_length(v_address) > 200) then
    raise exception 'DADOS_INVALIDOS: endereco';
  end if;

  if coalesce(p_payment_method, '') not in ('pix', 'card', 'cash') then
    raise exception 'DADOS_INVALIDOS: pagamento';
  end if;

  if p_payment_method = 'card' and coalesce(p_card_type, '') not in ('crédito', 'débito') then
    raise exception 'DADOS_INVALIDOS: cartao';
  end if;

  -- Itens: lista de { "id": "...", "qty": 1 }
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then
    raise exception 'DADOS_INVALIDOS: itens';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'DADOS_INVALIDOS: itens';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e ->> 'id', '') = ''
       or not (case when coalesce(e ->> 'qty', '') ~ '^[0-9]{1,2}$'
                    then (e ->> 'qty')::int between 1 and 50
                    else false end)
  ) then
    raise exception 'DADOS_INVALIDOS: itens';
  end if;

  -- Limite simples contra abuso: no máximo 3 pedidos do mesmo telefone em 10 minutos
  if (select count(*) from public.orders
       where customer_phone = v_phone
         and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'MUITOS_PEDIDOS';
  end if;

  -- Subtotal calculado com os preços do banco (junta ids repetidos)
  select count(*), coalesce(sum(p.price * i.qty), 0)
    into v_found, v_subtotal
  from (
    select e ->> 'id' as id, sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
  ) i
  join public.products p on p.id = i.id and p.active;

  select count(distinct e ->> 'id') into v_distinct
  from jsonb_array_elements(p_items) e;

  if v_found <> v_distinct then
    raise exception 'PRODUTO_INVALIDO';
  end if;

  -- Taxa de entrega
  if p_mode = 'delivery' then
    select delivery_fee into v_fee from public.settings where id = 1;
  end if;

  v_total := v_subtotal + v_fee;

  -- O total que o cliente viu precisa bater com o do servidor
  if p_expected_total is null or round(p_expected_total, 2) <> v_total then
    raise exception 'PRECO_DIVERGENTE';
  end if;

  -- Troco
  if p_payment_method = 'cash' and p_change_for is not null
     and (p_change_for < v_total or p_change_for > 10000) then
    raise exception 'TROCO_INVALIDO';
  end if;

  insert into public.orders (
    customer_name, customer_phone, mode, address,
    payment_method, card_type, change_for,
    subtotal, delivery_fee, total
  ) values (
    v_name, v_phone, p_mode,
    case when p_mode = 'delivery' then v_address end,
    p_payment_method,
    case when p_payment_method = 'card' then p_card_type end,
    case when p_payment_method = 'cash' then p_change_for end,
    v_subtotal, v_fee, v_total
  )
  returning * into v_order;

  insert into public.order_items (order_id, product_id, name, unit_price, qty)
  select v_order.id, p.id, p.name, p.price, i.qty
  from (
    select e ->> 'id' as id, sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
  ) i
  join public.products p on p.id = i.id and p.active;

  return jsonb_build_object(
    'id',           v_order.id,
    'number',       v_order.number,
    'subtotal',     v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'total',        v_order.total
  );
end;
$$;

revoke all on function public.create_order(text, text, text, text, text, text, numeric, jsonb, numeric) from public;
grant execute on function public.create_order(text, text, text, text, text, text, numeric, jsonb, numeric)
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. TEMPO REAL: o painel recebe os pedidos assim que eles chegam
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;
end $$;


-- ---------------------------------------------------------------------
-- 6. LIBERAR O PAINEL PARA A EQUIPE (faça depois de rodar o resto)
--    1) Authentication > Users > Add user: crie e-mail e senha da equipe.
--    2) Troque o e-mail abaixo pelo que você criou e rode só esta linha:
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'seu-email@exemplo.com'
-- on conflict do nothing;
-- ---------------------------------------------------------------------
