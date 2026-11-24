-- Associa a vaga ao cliente encontrado nas ordens de fabricação.
alter table public.recruitment_vacancies
  add column if not exists customer text;

create index if not exists idx_recruitment_vacancies_customer
  on public.recruitment_vacancies (lower(customer))
  where customer is not null;
