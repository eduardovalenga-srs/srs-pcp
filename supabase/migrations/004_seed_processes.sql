-- =============================================================
-- 004_seed_processes.sql
-- Processos iniciais da serralheria.
-- Novos processos (PINTURA, GALVANIZAÇÃO, USINAMEM, CORTE, DOBRA...)
-- bastam um INSERT nesta tabela — nenhuma mudança de schema.
-- =============================================================

insert into public.processes (code, name, display_order, active)
values
  ('LASER',   'LASER',    10,  true),
  ('DB_CH',   'DB CH',    20,  true),
  ('SERRA',   'SERRA',    30,  true),
  ('DB_TB',   'DB TB',    40,  true),
  ('PUNC',    'PUNC',     50,  true),
  ('FICEP',   'FICEP',    60,  true),
  ('KIT',     'KIT',      70,  true),
  ('PRE_MTG', 'PRÉ-MTG',  80,  true),
  ('SOLDA',   'SOLDA',    90,  true),
  ('ACAB',    'ACAB',     100, true),
  ('QUALITY', 'QUALITY',  110, true),
  ('EXP',     'EXP',      120, true)
on conflict (code) do update
  set name = excluded.name,
      display_order = excluded.display_order;
