-- =============================================================
-- 003_indexes.sql
-- Índices para as consultas da tela de produção, dashboard e logs.
-- (orders.code já é coberto pelo UNIQUE; process_id pelo UNIQUE
--  de production_processes — mantidos explícitos apenas os novos.)
-- =============================================================

create index if not exists idx_orders_delivery_date on public.orders (delivery_date);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_type on public.orders (type);

create index if not exists idx_order_items_family on public.order_items (family);
create index if not exists idx_order_items_delivery_date on public.order_items (delivery_date);
create index if not exists idx_order_items_status on public.order_items (status);
create index if not exists idx_order_items_parent_item on public.order_items (parent_item);
create index if not exists idx_order_items_order_id on public.order_items (order_id);

-- Busca textual por descrição/família (ILIKE) — escala do MVP não
-- exige trigram; se necessário, adicionar pg_trgm em versão futura.

create index if not exists idx_production_processes_status on public.production_processes (status);
create index if not exists idx_production_processes_process_id on public.production_processes (process_id);
create index if not exists idx_production_processes_order_item_id on public.production_processes (order_item_id);

create index if not exists idx_production_events_process_id
  on public.production_events (production_process_id);
create index if not exists idx_production_events_created_at
  on public.production_events (created_at desc);
create index if not exists idx_production_events_user_id
  on public.production_events (user_id);

create index if not exists idx_processes_active_order
  on public.processes (active, display_order);

-- Índices de import_batches / import_errors estão em 005_import_tables.sql.
