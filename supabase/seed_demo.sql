-- =============================================================
-- seed_demo.sql — dados de demonstração (OF-001..OF-008)
-- NÃO é uma migration: rode uma única vez no SQL Editor do Supabase
-- (ou via psql) depois das migrations 001..006.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed_demo.sql
--
-- É idempotente: apaga os pedidos de demonstração anteriores
-- (o que também apaga itens e processos, por cascade) e recria.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- Limpeza de execuções anteriores
-- -------------------------------------------------------------
delete from public.orders
where code in (
  'OF-001','OF-002','OF-003','OF-004','OF-005','OF-006','OF-007','OF-008',
  'OS-001','OS-002'
);

-- -------------------------------------------------------------
-- Pedidos (datas relativas a "hoje" para o demo nunca envelhecer)
-- -------------------------------------------------------------
insert into public.orders (code, type, customer_name, description, order_date, delivery_date, status)
values
  ('OF-001', 'OF', 'Metalúrgica Alfa',  'Estrutura de cobertura - galpão 2',   current_date - 25, current_date - 3, 'EM_PRODUCAO'),
  ('OF-002', 'OF', 'Construtora Beta',  'Guarda-corpo metálico - mezanino',     current_date - 18, current_date,     'EM_PRODUCAO'),
  ('OF-003', 'OF', 'Construtora Beta',  'Escada caracol - bloco A',             current_date - 12, current_date + 5,  'PLANEJADO'),
  ('OF-004', 'OF', 'Indústria Gama',    'Plataforma de manutenção - área 3',    current_date - 6,  current_date + 12, 'PLANEJADO'),
  ('OF-005', 'OF', 'Metalúrgica Alfa',  'Portas corta-fogo - 2 vias',           current_date - 9,  current_date + 3,  'EM_PRODUCAO'),
  ('OF-006', 'OF', 'Comércio Delta',    'Grade de proteção - janelas',          current_date - 40, current_date - 10, 'CONCLUIDO'),
  ('OF-007', 'OF', null,                'Reforço estrutural - pilares',         current_date - 2,  null,               'PLANEJADO'),
  ('OF-008', 'OF', 'Indústria Gama',    'Corrimão inox - externo',              current_date - 15, current_date + 20, 'CANCELADO'),
  ('OS-001', 'OS', 'Serralheria Épsilon','Reparo de portão basculante',         current_date - 4,  current_date + 2,  'EM_PRODUCAO'),
  ('OS-002', 'OS', 'Metalúrgica Alfa',  'Manutenção corretiva - esteira',       current_date - 1,  current_date + 8,  'PLANEJADO');

-- -------------------------------------------------------------
-- Itens (parent_item é a chave lógica junto com o código do pedido)
-- -------------------------------------------------------------
insert into public.order_items (
  order_id, family, parent_item, description, quantity,
  unit_weight_kg, delivery_date, status
)
select
  o.id, v.family, v.parent_item, v.description, v.quantity,
  v.unit_weight_kg, v.delivery_date, v.status
from (values
  ('OF-001', 'ESTRUTURA', 'IT-001A', 'Vigas C100 - vão 6 m',        12::numeric, 18.5::numeric, current_date - 3, 'EM_PRODUCAO'),
  ('OF-001', 'ESTRUTURA', 'IT-001B', 'Terças espelhadas',            24::numeric,  7.2::numeric, current_date - 3, 'EM_PRODUCAO'),
  ('OF-001', 'ESTRUTURA', 'IT-001C', 'Pilares de apoio',              6::numeric, 42.0::numeric, current_date - 3, 'PLANEJADO'),
  ('OF-002', 'GUARDA',    'IT-002A', 'Guarda-corpo 1,5 m',           18::numeric,  9.4::numeric, current_date,     'EM_PRODUCAO'),
  ('OF-002', 'GUARDA',    'IT-002B', 'Guarda-corpo 3,0 m',            9::numeric, 16.8::numeric, current_date,     'PLANEJADO'),
  ('OF-003', 'ESCADA',    'IT-003A', 'Degraus em chapa xadrez',      16::numeric, 11.2::numeric, current_date + 5,  'PLANEJADO'),
  ('OF-003', 'ESCADA',    'IT-003B', 'Mão-corrimão tubular 48,3 mm', 40::numeric,  3.1::numeric, current_date + 5,  'PLANEJADO'),
  ('OF-004', 'PLATAFORMA','IT-004A', 'Piso em treliça 2,0 x 1,0 m',  10::numeric, 24.6::numeric, current_date + 12, 'PLANEJADO'),
  ('OF-005', 'PORTAS',    'IT-005A', 'Folha de porta 1,0 x 2,1 m',    4::numeric, 55.0::numeric, current_date + 3,  'EM_PRODUCAO'),
  ('OF-005', 'PORTAS',    'IT-005B', 'Baton duplo (portas)',          4::numeric,  6.7::numeric, current_date + 3,  'PLANEJADO'),
  ('OF-006', 'GRADE',     'IT-006A', 'Grade 1,2 x 1,8 m',            20::numeric, 12.9::numeric, current_date - 10, 'CONCLUIDO'),
  ('OF-007', 'REFORÇO',   'IT-007A', 'Chapão de reforço 12 mm',       8::numeric, 31.5::numeric, null,               'PLANEJADO'),
  ('OF-008', 'CORRIMÃO',  'IT-008A', 'Corrimão inox 1,5"',          25::numeric,  4.4::numeric, current_date + 20, 'CANCELADO'),
  ('OS-001', 'REPARO',    'IT-101A', 'Reforço de dobradiça',          2::numeric,  2.0::numeric, current_date + 2,  'EM_PRODUCAO'),
  ('OS-002', 'MANUTENÇÃO','IT-202A', 'Rolo substituto - esteira 2',   6::numeric,  5.6::numeric, current_date + 8,  'PLANEJADO')
) as v(code, family, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
join public.orders o on o.code = v.code;

-- -------------------------------------------------------------
-- Situação de cada processo por item (catálogo vem do seed 004)
--   * pedido CONCLUIDO  -> todos os processos concluídos
--   * pedido CANCELADO  -> processos não aplicáveis
--   * demais            -> progresso parcial com bloqueios
-- -------------------------------------------------------------
insert into public.production_processes (
  order_item_id, process_id, status,
  quantity_planned, quantity_completed, started_at, completed_at, notes
)
select
  oi.id,
  p.id,
  case
    when oi.status = 'CONCLUIDO' then 'CONCLUIDO'
    when oi.status = 'CANCELADO' then 'NAO_APLICAVEL'
    when p.code in ('LASER', 'DB_CH', 'SERRA') then 'CONCLUIDO'
    when p.code = 'DB_TB' then case when oi.parent_item in ('IT-001A','IT-002A','IT-005A') then 'EM_ANDAMENTO' else 'NAO_INICIADO' end
    when p.code = 'SOLDA' then case when oi.parent_item in ('IT-001A','IT-002A') then 'EM_ANDAMENTO' else 'NAO_INICIADO' end
    when p.code = 'FICEP' and oi.parent_item in ('IT-001B','IT-004A') then 'BLOQUEADO'
    when p.code = 'PUNC'  and oi.parent_item in ('IT-001A','IT-003A') then 'EM_ANDAMENTO'
    when p.code = 'KIT'   and oi.parent_item in ('IT-001A','IT-002A','IT-006A') then 'CONCLUIDO'
    when p.code in ('QUALITY', 'EXP', 'ACAB', 'PRE_MTG') then 'NAO_INICIADO'
    else 'NAO_INICIADO'
  end as status,
  oi.quantity as quantity_planned,
  case
    when oi.status = 'CONCLUIDO' then oi.quantity
    when p.code in ('LASER', 'DB_CH') then oi.quantity
    else 0
  end as quantity_completed,
  case
    when oi.status = 'CONCLUIDO' or p.code in ('LASER', 'DB_CH') then now() - interval '2 days'
    else null
  end as started_at,
  case
    when oi.status = 'CONCLUIDO' or p.code in ('LASER', 'DB_CH') then now() - interval '1 day'
    else null
  end as completed_at,
  case
    when p.code = 'FICEP' and oi.parent_item in ('IT-001B','IT-004A')
      then 'Aguardando ferramenta de dobragem 4'
    else null
  end as notes
from public.order_items oi
cross join public.processes p
where oi.parent_item like 'IT-%';

commit;

-- -------------------------------------------------------------
-- Resumo esperado:
--   10 pedidos, 15 itens, 15 x (processos ativos) linhas de produção
--   * OF-001 e OF-002 com entrega vencida (aparecem como ATRASADOS)
--   * OF-002 entrega hoje; OF-003/OF-005/OS-001/OS-002 nas janelas de 7/30 dias
--   * OF-006 concluído; OF-008 cancelado
-- -------------------------------------------------------------
