-- =====================================================================
-- DevBurguer - acompanhamento do pedido pelo cliente
--
-- Rode DEPOIS do supabase-schema.sql: SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema.
-- =====================================================================

-- 1. Guarda quando o pedido mudou de status pela última vez
alter table public.orders
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_orders_updated_at();


-- 2. Consulta do cliente: só devolve o pedido se número E telefone baterem.
--    Não devolve nome nem endereço, só o que a tela de acompanhamento mostra.
create or replace function public.get_order_status(p_number int, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_order public.orders%rowtype;
begin
  if p_number is null or char_length(v_phone) < 10 or char_length(v_phone) > 11 then
    return null;
  end if;

  select * into v_order
  from public.orders
  where number = p_number
    and customer_phone = v_phone;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'number',         v_order.number,
    'status',         v_order.status,
    'mode',           v_order.mode,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'total',          v_order.total,
    'created_at',     v_order.created_at,
    'updated_at',     v_order.updated_at,
    'items',          coalesce((
                        select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.id)
                        from public.order_items i
                        where i.order_id = v_order.id
                      ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_order_status(int, text) from public;
grant execute on function public.get_order_status(int, text) to anon, authenticated;
