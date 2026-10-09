-- -------------------------------------------------------------
-- 010) Backfill de processos por item
--
-- Invariante: todo item possui linha em production_processes para
-- TODO processo ativo do catálogo. A ausência de linha nunca é
-- intencional — o estado explícito de "não se aplica" é
-- NAO_APLICAVEL, gravado ao desmarcar o processo no pedido.
-- Sem a linha, a célula da gestão de entregas mostra "—" e NÃO
-- exibe a data prevista de execução.
--
-- A linha nasce em três pontos:
--   - salvar pedido (processos selecionados no item);
--   - importar Excel (colunas de processo da planilha);
--   - criar/reativar processo (ação do catálogo) e ESTA migração,
--     que corrige os órfãos já existentes (ex.: processo
--     "Metaleira" criado depois dos itens).
--
-- Idempotente: não duplica (unicidade item+processo) e nunca
-- altera status existente.
-- -------------------------------------------------------------
create or replace function public.backfill_process(p_process_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  -- Processo informado precisa existir e estar ativo.
  if p_process_id is not null and not exists (
    select 1 from public.processes where id = p_process_id and active
  ) then
    raise exception 'Processo inválido ou inativo';
  end if;

  -- Cria as linhas ausentes (null = todos os processos ativos).
  insert into public.production_processes (order_item_id, process_id, status)
  select oi.id, p.id, 'NAO_INICIADO'
    from public.order_items oi
    cross join public.processes p
   where p.active
     and (p_process_id is null or p.id = p_process_id)
  on conflict (order_item_id, process_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.backfill_process(uuid) from anon;
grant execute on function public.backfill_process(uuid) to authenticated;

-- Corrige os órfãos atuais no momento da migração (processo criado
-- depois dos itens deixa de ficar sem data na gestão de entregas).
select public.backfill_process(null);
