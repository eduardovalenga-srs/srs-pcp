alter table public.recruitment_candidates
  add column if not exists interviewer_name text;

alter table public.recruitment_candidates
  add constraint recruitment_candidates_interviewer_name_length
  check (
    interviewer_name is null
    or (
      btrim(interviewer_name) <> ''
      and char_length(btrim(interviewer_name)) <= 150
    )
  );
