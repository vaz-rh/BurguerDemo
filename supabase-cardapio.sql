-- =====================================================================
-- DevBurguer - cardápio e taxa de entrega lidos do banco
--
-- Rode DEPOIS do supabase-schema.sql: SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema (não mexe em preços nem em nomes).
-- =====================================================================

-- 1. Colunas que o site usa para montar os cards do cardápio
alter table public.products
  add column if not exists emoji      text,
  add column if not exists image_url  text,
  add column if not exists badge      text,
  add column if not exists sort_order int not null default 100;

-- 2. Preenche emoji, selo e ordem dos produtos iniciais (só onde ainda está vazio)
update public.products set emoji = '🍔', sort_order = 10 where id = 'x-burguer'     and emoji is null;
update public.products set emoji = '🥓', sort_order = 20 where id = 'x-bacon'       and emoji is null;
update public.products set emoji = '🍔', sort_order = 30, badge = 'Novidade!'
                                                          where id = 'bacon-duplo'   and emoji is null;
update public.products set emoji = '🍟', sort_order = 40 where id = 'porcao-batata' and emoji is null;
update public.products set emoji = '🥤', sort_order = 50 where id = 'coca-cola-350' and emoji is null;
update public.products set emoji = '🥛', sort_order = 60 where id = 'milkshake'     and emoji is null;

-- 3. Fotos: cole o endereço (URL) de cada imagem. Exemplo:
--
-- update public.products set image_url = 'https://exemplo.com/x-bacon.jpg' where id = 'x-bacon';
--
-- Você também pode editar direto em Table Editor > products.

-- =====================================================================
-- COMO ALTERAR O CARDÁPIO DAQUI PARA A FRENTE (sem mexer no código do site)
--
--   Table Editor > products
--     - mudar preço ou nome: edite a célula e salve;
--     - tirar um produto do ar: coloque active = false;
--     - novo produto: Insert row (id sem espaços, ex.: 'combo-casal', e preencha
--       name, price, emoji, sort_order; image_url e badge são opcionais);
--   Table Editor > settings
--     - taxa de entrega: edite delivery_fee.
--
-- As páginas leem os valores novos a cada visita.
-- =====================================================================
