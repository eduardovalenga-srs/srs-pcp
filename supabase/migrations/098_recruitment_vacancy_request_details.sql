-- Detalha a solicitação da vaga e relaciona suas escolhas à árvore de alocações.
alter table public.recruitment_vacancies
  add column if not exists request_reason text not null default 'NOVA_VAGA',
  add column if not exists replacement_employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists allocation_client_id uuid references public.employee_allocation_nodes(id) on delete set null,
  add column if not exists allocation_location_id uuid references public.employee_allocation_nodes(id) on delete set null,
  add column if not exists allocation_area_id uuid references public.employee_allocation_nodes(id) on delete set null,
  add column if not exists allocation_position_id uuid references public.employee_allocation_nodes(id) on delete set null;

alter table public.recruitment_vacancies
  drop constraint if exists recruitment_vacancies_status_check;
alter table public.recruitment_vacancies
  add constraint recruitment_vacancies_status_check
  check (status in ('RASCUNHO', 'ABERTA', 'PAUSADA', 'PREENCHIDA', 'ENCERRADA', 'CANCELADA'));

alter table public.recruitment_vacancies
  add constraint recruitment_vacancies_request_reason_check
  check (request_reason in ('NOVA_VAGA', 'SUBSTITUICAO', 'REFORCO'));

alter table public.recruitment_vacancies
  add constraint recruitment_vacancies_replacement_employee_check
  check (
    (request_reason = 'SUBSTITUICAO' and replacement_employee_id is not null)
    or (request_reason <> 'SUBSTITUICAO' and replacement_employee_id is null)
  );

create index if not exists idx_recruitment_vacancies_allocation_client
  on public.recruitment_vacancies (allocation_client_id);
