-- -------------------------------------------------------------
-- 023) Peso total DERIVADO (quantidade × peso unitário)
--
-- Problema: order_items.total_weight_kg só era preenchido pela
-- importação (coluna pos_PesoTotal da planilha). O pedido MANUAL
-- gravava NULL — o formulário não envia o total e a RPC apply_import
-- lê {item,totalWeightKg}, que não existia no plano — e a edição de
-- quantidade/peso unitário nunca recalculava o valor antigo (a RPC
-- usa coalesce(json, coluna)). Resultado: o card "Peso total" do
-- detalhe da OF aparecia vazio ("—") em todo pedido criado à mão.
--
-- Correção (fonte única, cobre manual E importação):
--   1. backfill de todo o histórico (qtd × peso unit., 3 casas);
--   2. trigger BEFORE INSERT/UPDATE recalcula a coluna a partir de
--      quantity × unit_weight_kg — vale para formulário, importação,
--      RPCs e escrita direta. O pos_PesoTotal da planilha deixa de
--      ser gravado e passa a virar apenas AVISO na prévia quando
--      divergir da fórmula (of-structure.ts);
--   3. índices para as telas de maior volume (base ≥ 10 mil itens):
--      só itens raiz, FK de item pai e busca textual (pg_trgm).
--
-- A assinatura de nenhuma RPC muda — o PostgREST continua chamando
-- pelas mesmas 20 posições/nomes.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Backfill do histórico (idempotente)
-- -------------------------------------------------------------
update public.order_items
   set total_weight_kg = trim_scale(round(quantity * unit_weight_kg, 3))
 where unit_weight_kg is not null
   and total_weight_kg is distinct from trim_scale(round(quantity * unit_weight_kg, 3));

update public.order_items
   set total_weight_kg = null
 where unit_weight_kg is null
   and total_weight_kg is not null;

-- -------------------------------------------------------------
-- 2) Trigger: o total é SEMPRE quantidade × peso unitário
-- -------------------------------------------------------------
create or replace function public.set_item_total_weight()
returns trigger
language plpgsql
as $$
begin
  new.total_weight_kg := case
    when new.quantity is not null and new.unit_weight_kg is not null
      -- trim_scale: 4 × 12,5 vira 50 (não 50,000) — mesmo formato do
      -- valor exibido e do que a importação gravava.
      then trim_scale(round(new.quantity * new.unit_weight_kg, 3))
    else null
  end;
  return new;
end;
$$;

drop trigger if exists order_items_total_weight on public.order_items;
create trigger order_items_total_weight
  before insert or update on public.order_items
  for each row
  execute function public.set_item_total_weight();

-- -------------------------------------------------------------
-- 3) Índices das telas de maior volume
-- -------------------------------------------------------------
-- "Só itens raiz" (gestão de entregas, stats, prévia da importação).
create index if not exists idx_order_items_root
  on public.order_items (order_id)
  where parent_order_item_id is null;

-- Self-join pai -> filhos (Fábrica 1 busca os pais da página).
create index if not exists idx_order_items_parent_item_id
  on public.order_items (parent_order_item_id);

-- Busca textual (ilike '%term%') — sem trigram é seq scan puro.
-- O extension é criado dentro de bloco com exception: se o ambiente
-- não tiver pg_trgm (ex.: PGlite dos testes), apenas avisa e a busca
-- continua funcionando com varredura sequencial.
do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm indisponível — busca textual segue com seq scan';
  end;

  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists idx_orders_code_trgm
      on public.orders using gin (code gin_trgm_ops);
    create index if not exists idx_orders_customer_trgm
      on public.orders using gin (customer_name gin_trgm_ops);
    create index if not exists idx_order_items_description_trgm
      on public.order_items using gin (description gin_trgm_ops);
    create index if not exists idx_order_items_family_trgm
      on public.order_items using gin (family gin_trgm_ops);
    create index if not exists idx_order_items_parent_item_trgm
      on public.order_items using gin (parent_item gin_trgm_ops);
  end if;
end $$;
