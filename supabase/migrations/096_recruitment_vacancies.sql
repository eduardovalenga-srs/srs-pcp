-- Gestão de vagas e acompanhamento dos candidatos pelo time de recrutamento.
create or replace function public.can_manage_recruitment()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('ADMIN', 'GESTOR')
  );
$$;

revoke all on function public.can_manage_recruitment() from public, anon;
grant execute on function public.can_manage_recruitment() to authenticated;

create table if not exists public.recruitment_vacancies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null,
  location text,
  employment_type text not null default 'CLT',
  quantity integer not null default 1,
  description text,
  requirements text,
  salary_range text,
  requester text,
  recruiter text,
  priority text not null default 'NORMAL',
  status text not null default 'RASCUNHO',
  opening_date date not null default current_date,
  target_date date,
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint recruitment_vacancies_title_not_blank check (btrim(title) <> ''),
  constraint recruitment_vacancies_department_not_blank check (btrim(department) <> ''),
  constraint recruitment_vacancies_quantity_positive check (quantity > 0),
  constraint recruitment_vacancies_priority_check check (priority in ('BAIXA', 'NORMAL', 'ALTA')),
  constraint recruitment_vacancies_status_check check (
    status in ('RASCUNHO', 'ABERTA', 'PAUSADA', 'ENCERRADA', 'CANCELADA')
  )
);

create index if not exists idx_recruitment_vacancies_status
  on public.recruitment_vacancies (status, opening_date desc);
create index if not exists idx_recruitment_vacancies_title
  on public.recruitment_vacancies (lower(title));

drop trigger if exists recruitment_vacancies_set_updated_at on public.recruitment_vacancies;
create trigger recruitment_vacancies_set_updated_at
  before update on public.recruitment_vacancies
  for each row execute function public.set_updated_at();

create table if not exists public.recruitment_candidates (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.recruitment_vacancies(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  source text,
  stage text not null default 'NOVO',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint recruitment_candidates_name_not_blank check (btrim(name) <> ''),
  constraint recruitment_candidates_stage_check check (
    stage in ('NOVO', 'TRIAGEM', 'ENTREVISTA', 'APROVADO', 'REPROVADO', 'CONTRATADO')
  )
);

create index if not exists idx_recruitment_candidates_vacancy_stage
  on public.recruitment_candidates (vacancy_id, stage, created_at desc);
create index if not exists idx_recruitment_candidates_name
  on public.recruitment_candidates (lower(name));

drop trigger if exists recruitment_candidates_set_updated_at on public.recruitment_candidates;
create trigger recruitment_candidates_set_updated_at
  before update on public.recruitment_candidates
  for each row execute function public.set_updated_at();

alter table public.recruitment_vacancies enable row level security;
alter table public.recruitment_candidates enable row level security;

drop policy if exists "recruitment_vacancies_select" on public.recruitment_vacancies;
create policy "recruitment_vacancies_select" on public.recruitment_vacancies
  for select to authenticated using (public.can_manage_recruitment());
drop policy if exists "recruitment_vacancies_insert" on public.recruitment_vacancies;
create policy "recruitment_vacancies_insert" on public.recruitment_vacancies
  for insert to authenticated with check (public.can_manage_recruitment());
drop policy if exists "recruitment_vacancies_update" on public.recruitment_vacancies;
create policy "recruitment_vacancies_update" on public.recruitment_vacancies
  for update to authenticated using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());
drop policy if exists "recruitment_vacancies_delete" on public.recruitment_vacancies;
create policy "recruitment_vacancies_delete" on public.recruitment_vacancies
  for delete to authenticated using (public.can_manage_recruitment());

drop policy if exists "recruitment_candidates_select" on public.recruitment_candidates;
create policy "recruitment_candidates_select" on public.recruitment_candidates
  for select to authenticated using (public.can_manage_recruitment());
drop policy if exists "recruitment_candidates_insert" on public.recruitment_candidates;
create policy "recruitment_candidates_insert" on public.recruitment_candidates
  for insert to authenticated with check (public.can_manage_recruitment());
drop policy if exists "recruitment_candidates_update" on public.recruitment_candidates;
create policy "recruitment_candidates_update" on public.recruitment_candidates
  for update to authenticated using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());
drop policy if exists "recruitment_candidates_delete" on public.recruitment_candidates;
create policy "recruitment_candidates_delete" on public.recruitment_candidates
  for delete to authenticated using (public.can_manage_recruitment());

grant select, insert, update, delete on public.recruitment_vacancies to authenticated;
grant select, insert, update, delete on public.recruitment_candidates to authenticated;
revoke all on public.recruitment_vacancies, public.recruitment_candidates from anon;
