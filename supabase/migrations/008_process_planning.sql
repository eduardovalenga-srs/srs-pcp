-- ==============================================================
-- 008: local do processo + duração em dias
--
--  * location     — onde o processo acontece (ex.: "Fábrica 1").
--  * duration_days — dias corridos que o processo leva; alimenta o
--    cálculo das datas previstas de execução de cada etapa,
--    contadas de trás para frente a partir da data de entrega.
--
-- Registros existentes ganham duração 1 dia (mínimo válido).
-- ==============================================================

alter table public.processes
  add column if not exists location text,
  add column if not exists duration_days integer not null default 1;

alter table public.processes drop constraint if exists processes_duration_days_check;
alter table public.processes
  add constraint processes_duration_days_check
  check (duration_days >= 1 and duration_days <= 365);

comment on column public.processes.location is
  'Onde o processo acontece, ex.: Fábrica 1, Fábrica 2.';
comment on column public.processes.duration_days is
  'Dias corridos que o processo leva para ser concluído (1 a 365).';
