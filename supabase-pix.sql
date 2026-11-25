-- =====================================================================
-- DevBurguer - Pix com confirmação automática (Mercado Pago)
--
-- Rode DEPOIS do supabase-schema.sql e do supabase-acompanhamento.sql:
-- SQL Editor > New query > cole tudo > Run. Pode rodar de novo sem problema.
-- =====================================================================

-- 1. Novo status: pedido Pix que ainda não foi pago
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting_payment','received','preparing','ready','out_for_delivery','delivered','cancelled'));

-- 2. Todo pedido Pix nasce "aguardando pagamento": só chega à cozinha depois de pago
create or replace function public.orders_set_initial_status()
returns trigger
language plpgsql
as $$
begin
  if new.payment_method = 'pix' then
    new.status := 'awaiting_payment';
    new.payment_status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_initial_status on public.orders;
create trigger orders_initial_status
  before insert on public.orders
  for each row execute function public.orders_set_initial_status();

-- 3. Pagamentos Pix (só a Edge Function "pix" lê e escreve aqui; ninguém mais)
create table if not exists public.payments (
  order_id        uuid primary key references public.orders (id) on delete cascade,
  mp_payment_id   text unique,
  status          text,
  qr_code         text,
  qr_code_base64  text,
  amount          numeric(10,2) not null,
  expires_at      timestamptz,
  attempts        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

-- =====================================================================
-- OPCIONAL: limpeza de pedidos Pix que ninguém pagou
-- O Mercado Pago avisa quando o Pix expira e o pedido é cancelado sozinho.
-- Se algum aviso se perder, rode isto de vez em quando:
--
-- update public.orders
-- set status = 'cancelled'
-- where status = 'awaiting_payment'
--   and created_at < now() - interval '2 hours';
-- =====================================================================
