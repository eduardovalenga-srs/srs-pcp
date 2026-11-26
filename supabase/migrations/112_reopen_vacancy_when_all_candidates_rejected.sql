create or replace function public.reopen_recruitment_vacancy_when_all_candidates_rejected()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.stage = 'REPROVADO' then
    -- Serialize competing candidate rejections for this vacancy.
    perform 1
      from public.recruitment_vacancies vacancy
     where vacancy.id = new.vacancy_id
     for update;

    if exists (
       select 1
         from public.recruitment_candidates candidate
        where candidate.vacancy_id = new.vacancy_id
     )
       and not exists (
       select 1
         from public.recruitment_candidates candidate
        where candidate.vacancy_id = new.vacancy_id
          and candidate.stage <> 'REPROVADO'
     ) then
      update public.recruitment_vacancies vacancy
         set status = 'VAGAS_ABERTAS',
             selected_candidate_id = null,
             updated_by = coalesce(new.updated_by, vacancy.updated_by)
       where vacancy.id = new.vacancy_id
         and (
           vacancy.status <> 'VAGAS_ABERTAS'
           or vacancy.selected_candidate_id is not null
         );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists recruitment_candidates_reopen_all_rejected_vacancy
  on public.recruitment_candidates;
create trigger recruitment_candidates_reopen_all_rejected_vacancy
  after update of stage on public.recruitment_candidates
  for each row
  execute function public.reopen_recruitment_vacancy_when_all_candidates_rejected();
