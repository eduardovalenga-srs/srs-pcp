begin;

alter table public.employees
  add column if not exists last_allocation_position_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'employees_last_allocation_position_fkey'
       and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_last_allocation_position_fkey
      foreign key (last_allocation_position_id)
      references public.employee_allocation_nodes(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_employees_last_allocation_position
  on public.employees (last_allocation_position_id)
  where last_allocation_position_id is not null;

-- Recover any inactive employee still occupying a position, then release it.
update public.employees
   set last_allocation_position_id = coalesce(last_allocation_position_id, allocation_position_id),
       allocation_position_id = null,
       client = null,
       location = null,
       area = null,
       shift = null
 where dismissal_date is not null
   and allocation_position_id is not null;

-- Keep the previous position for vacancy history, but clear the live assignment.
create or replace function public.release_employee_allocation_on_dismissal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.dismissal_date is null and new.dismissal_date is not null then
    if new.allocation_position_id is not null then
      update public.employees
         set last_allocation_position_id = new.allocation_position_id,
             allocation_position_id = null,
             client = null,
             location = null,
             area = null,
             shift = null
       where id = new.id;
    end if;
  elsif old.dismissal_date is not null and new.dismissal_date is null then
    update public.employees
       set last_allocation_position_id = null
     where id = new.id
       and last_allocation_position_id is not null;
  end if;
  return new;
end;
$$;

commit;
