-- -------------------------------------------------------------
-- 009) Reordenação da cadeia de processos (arrastar e soltar)
--
-- A ordem da cadeia (display_order) passa a ser gerenciada pela UI:
--   - cadastro: o servidor anexa ao final (máximo + 1);
--   - lista /processos: o ADMIN arrasta as linhas e a nova ordem
--     é salva em UMA única transação por esta função.
-- Os códigos (LASER, SOLDA…) NÃO mudam: são a chave da importação
-- de Excel, dos filtros em URL e do histórico de eventos.
-- -------------------------------------------------------------

create or replace function public.reorder_processes(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_encontrados int;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'Lista de processos vazia';
  end if;

  -- Um id desconhecido (lista desatualizada) ou uma repetição
  -- derruba a contagem: nenhum dado é alterado nesse caso.
  select count(*) into v_encontrados from public.processes where id = any(p_ids);
  if v_encontrados <> array_length(p_ids, 1) then
    raise exception 'Lista de processos inválida';
  end if;

  -- Posição 1..N conforme a ordem do array (unicidade do update).
  update public.processes p
     set display_order = ord.pos::int
    from unnest(p_ids) with ordinality as ord(id, pos)
   where p.id = ord.id;
end;
$$;

revoke execute on function public.reorder_processes(uuid[]) from anon;
grant execute on function public.reorder_processes(uuid[]) to authenticated;
