-- Fluxo de recrutamento por vaga, com agendas e candidato selecionado.
alter table public.recruitment_vacancies
  add column if not exists selected_candidate_id uuid
    references public.recruitment_candidates(id) on delete set null;

alter table public.recruitment_candidates
  add column if not exists triage_scheduled_at timestamptz,
  add column if not exists interview_scheduled_at timestamptz,
  add column if not exists aso_scheduled_at timestamptz,
  add column if not exists integration_scheduled_at timestamptz,
  add column if not exists hired_at date;

alter table public.recruitment_vacancies
  alter column status set default 'VAGAS_ABERTAS';
alter table public.recruitment_candidates
  alter column stage set default 'TRIAGEM';

alter table public.recruitment_vacancies
  drop constraint if exists recruitment_vacancies_status_check;
alter table public.recruitment_candidates
  drop constraint if exists recruitment_candidates_stage_check;

-- As etapas anteriores do candidato são preservadas no fluxo correspondente.
update public.recruitment_candidates
   set stage = case stage
     when 'NOVO' then 'TRIAGEM'
     when 'APROVADO' then 'ENTREVISTA'
     else stage
   end
 where stage in ('NOVO', 'APROVADO');

-- Reabre status administrativos/terminais antigos conforme a nova regra.
-- Vagas já preenchidas passam para Contratados; sem candidato/data anterior,
-- esses dados permanecem pendentes de preenchimento manual.
update public.recruitment_vacancies
   set status = case
     when status = 'PREENCHIDA'
       or exists (
         select 1
           from public.recruitment_candidates candidate
          where candidate.vacancy_id = recruitment_vacancies.id
            and candidate.stage = 'CONTRATADO'
       )
       then 'CONTRATADOS'
     else 'VAGAS_ABERTAS'
   end;

update public.recruitment_vacancies vacancy
   set selected_candidate_id = (
     select candidate.id
       from public.recruitment_candidates candidate
      where candidate.vacancy_id = vacancy.id
        and candidate.stage = 'CONTRATADO'
      order by candidate.updated_at desc, candidate.created_at desc
      limit 1
   )
 where vacancy.status = 'CONTRATADOS'
   and vacancy.selected_candidate_id is null;

alter table public.recruitment_vacancies
  add constraint recruitment_vacancies_status_check
  check (status in (
    'VAGAS_ABERTAS',
    'TRIAGEM',
    'ENTREVISTA',
    'AGENDAMENTO_ASO',
    'INTEGRACAO',
    'CONTRATADOS'
  ));

alter table public.recruitment_candidates
  add constraint recruitment_candidates_stage_check
  check (stage in (
    'TRIAGEM',
    'ENTREVISTA',
    'AGENDAMENTO_ASO',
    'INTEGRACAO',
    'CONTRATADO',
    'REPROVADO'
  ));

create index if not exists idx_recruitment_vacancies_selected_candidate
  on public.recruitment_vacancies (selected_candidate_id);

create or replace function public.validate_recruitment_vacancy_selected_candidate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.selected_candidate_id is not null and not exists (
    select 1
      from public.recruitment_candidates candidate
     where candidate.id = new.selected_candidate_id
       and candidate.vacancy_id = new.id
  ) then
    raise exception 'O candidato selecionado não pertence a esta vaga.';
  end if;
  return new;
end;
$$;

drop trigger if exists recruitment_vacancies_validate_selected_candidate
  on public.recruitment_vacancies;
create trigger recruitment_vacancies_validate_selected_candidate
  before insert or update of selected_candidate_id on public.recruitment_vacancies
  for each row execute function public.validate_recruitment_vacancy_selected_candidate();
