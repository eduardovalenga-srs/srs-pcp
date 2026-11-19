-- Posições representam vagas individuais e podem compartilhar o mesmo nome
-- dentro da mesma área. Os demais níveis permanecem únicos entre irmãos.
begin;

drop index if exists public.employee_allocation_nodes_unique_sibling;

create unique index employee_allocation_nodes_unique_sibling
  on public.employee_allocation_nodes (
    company_code,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    node_type,
    lower(btrim(name))
  )
  where node_type <> 'POSITION';

commit;
