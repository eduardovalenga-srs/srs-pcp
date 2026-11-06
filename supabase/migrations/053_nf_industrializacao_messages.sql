-- -------------------------------------------------------------
-- 053) Romaneio — mensagem da confirm_romaneio: "nota de
--      industrialização"
--
-- O termo exibido ao usuário para o número que antes se chamava "NF
-- de saída" passou a ser "nota de industrialização" em todo o
-- processo de romaneio (rótulos, filtros, exportação e mensagens).
--
-- A única mensagem de RPC ainda com o termo antigo é a da
-- confirm_romaneio ('Registre o número da NF de saída antes de
-- confirmar o romaneio.') — recriada aqui com o texto novo. As
-- demais mensagens do fluxo continuam iguais.
--
-- Observação: 'Limpe o número da NF de saída antes de cancelar.'
-- (cancel_romaneio) só existia na 042, cuja função foi substituída
-- pela 045/046 — mensagem morta, sem impacto no banco.
--
-- O corpo é idêntico ao da 045 (gates, EXP e teto da expedição
-- parcial inalterados); muda só a mensagem.
-- -------------------------------------------------------------

create or replace function public.confirm_romaneio(p_romaneio_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id       uuid := auth.uid();
  v_order_id      uuid;
  v_order_status  text;
  v_status        text;
  v_nf            text;
  v_item_count    integer;
  v_pending_exp   integer;
  v_over_limit    integer;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.order_id, r.status, r.nf_number
    into v_order_id, v_status, v_nf
    from public.romaneios r
   where r.id = p_romaneio_id;

  if v_order_id is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status <> 'CONFERIDO' then
    raise exception 'Apenas romaneios conferidos podem ser confirmados.';
  end if;
  if nullif(trim(coalesce(v_nf, '')), '') is null then
    raise exception 'Registre o número da nota de industrialização antes de confirmar o romaneio.';
  end if;

  select o.status into v_order_status from public.orders o where o.id = v_order_id;
  if v_order_status = 'CANCELADO' then
    raise exception 'A OF está cancelada.';
  end if;

  select count(*) into v_item_count
    from public.romaneio_items ri
   where ri.romaneio_id = p_romaneio_id;
  if v_item_count = 0 then
    raise exception 'Inclua ao menos um item no romaneio.';
  end if;

  -- Gate de produção: EXP aplicável CONCLUIDO em todos os itens raiz.
  select count(*) into v_pending_exp
    from public.order_items oi
    join public.production_processes pp on pp.order_item_id = oi.id
    join public.processes pr on pr.id = pp.process_id and pr.code = 'EXP'
   where oi.order_id = v_order_id
     and oi.parent_order_item_id is null
     and pp.status <> 'NAO_APLICAVEL'
     and pp.status <> 'CONCLUIDO';

  if v_pending_exp > 0 then
    raise exception 'A OF tem % item(ns) raiz com EXPEDIÇÃO pendente.', v_pending_exp;
  end if;

  -- Teto da expedição parcial: Σ confirmado (outros romaneios) + este ≤ qtd do item.
  select count(*) into v_over_limit
    from public.romaneio_items ri
    join public.order_items oi on oi.id = ri.order_item_id
   where ri.romaneio_id = p_romaneio_id
     and ri.quantity + coalesce(
       (
         select sum(ri2.quantity)
           from public.romaneio_items ri2
           join public.romaneios r2 on r2.id = ri2.romaneio_id
          where ri2.order_item_id = ri.order_item_id
            and r2.status = 'CONFIRMADO'
       ),
       0
     ) > oi.quantity;

  if v_over_limit > 0 then
    raise exception 'Quantidade maior que a pendência de expedição em % item(ns).', v_over_limit;
  end if;

  update public.romaneios
     set status = 'CONFIRMADO',
         emitted_at = now(),
         emitted_by = v_user_id,
         updated_by = v_user_id
   where id = p_romaneio_id;

  if not found then
    raise exception 'Sem permissão para confirmar o romaneio (ADMIN/GESTOR).';
  end if;
end;
$$;

revoke execute on function public.confirm_romaneio(uuid) from anon;
grant execute on function public.confirm_romaneio(uuid) to authenticated;
