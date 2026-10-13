-- =============================================================
-- clear_data.sql — limpa TODO o movimento para reimportar/testar
-- NÃO é uma migration: roda MANUALMENTE quando quiser zerar a base
-- (SQL Editor do Supabase ou psql). Não roda automático em deploy.
--
--   psql "$SUPABASE_DB_URL" -f supabase/clear_data.sql
--
-- APAGA (irreversível):
--   orders -> order_items -> order_item_materials
--          -> production_processes -> production_events   (tudo em cascade)
--   import_batches -> import_errors (histórico de importação)
--
-- PRESERVA:
--   profiles (usuários), processes (catálogo da cadeia fabril),
--   RLS, RPCs e demais configs do banco.
--
-- Dica: rode primeiro no banco de DEV. Em produção, só quando for
-- de fato zerar o movimento. Depois, refaça as importações e crie
-- pedidos novos manualmente (ou rode supabase/seed_demo.sql).
-- =============================================================

begin;

-- Contagem visível antes da limpeza (aparece no SQL Editor/psql).
do $$
declare
  v_orders  integer;
  v_items   integer;
  v_batches integer;
begin
  select count(*) into v_orders  from public.orders;
  select count(*) into v_items   from public.order_items;
  select count(*) into v_batches from public.import_batches;

  raise notice 'clear_data: % pedido(s), % item(ns) filho(s), % lote(s) de importação serão apagados',
    v_orders, v_items, v_batches;
end $$;

-- Movimento de produção e entregas (cascade cobre itens, materiais,
-- processos de produção e eventos).
truncate public.orders cascade;

-- Histórico de importação (cascade cobre os erros por linha).
truncate public.import_batches cascade;

commit;
