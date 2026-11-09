-- -------------------------------------------------------------
-- 055) Perfis por fábrica: OPERADOR vira OPERADOR_F1 + OPERADOR_F2
--
-- Contexto: o antigo OPERADOR só enxergava a Fábrica 1 (a capability
-- fabrica2.view era exclusiva de ADMIN/GESTOR). Com a tela /fabrica-2
-- virando o dia a dia de outros processos, nasce um papel específico
-- para cada fábrica:
--
--   * OPERADOR_F1 — cópia fiel do antigo OPERADOR (Fábrica 1, dashboard,
--     RH e romaneio em modo consulta). Os usuários existentes são
--     migrados para ele: nenhum acesso muda;
--   * OPERADOR_F2 — restrito à Fábrica 2 (menu + página + atualização
--     de status na própria tela). Sem dashboard, RH, romaneio, gestão
--     de OF e sem a Fábrica 1.
--
-- O que muda:
--   1. Migração de dados: as linhas com o antigo 'OPERADOR' viram
--      'OPERADOR_F1' — feita ANTES do novo CHECK, que valida na hora;
--   2. CHECK de profiles.role passa a aceitar os 5 valores (o antigo
--      'OPERADOR' deixa de existir);
--   3. default da coluna e do trigger handle_new_user: 'OPERADOR_F1';
--   4. policies de escrita de produção (production_processes insert/
--      update, production_events insert) e a RPC SECURITY DEFINER
--      refresh_order_statuses citam os dois papéis novos — sem elas o
--      update de status falharia com 42501 (RLS de orders/order_items
--      é só ADMIN/GESTOR).
--
-- Fora de escopo: policies ADMIN/GESTOR (romaneio, import, materiais)
-- e as leituras `using (true)` — inalteradas.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Migração de dados + CHECK de papel com os 5 valores
--
-- Ordem importa: o ADD CONSTRAINT valida as linhas EXISTENTES na hora
-- (erro 23514 se sobrar algum 'OPERADOR'), por isso o UPDATE vem
-- primeiro. O drop é `if exists` para o script ser reexecutável.
-- -------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
   set role = 'OPERADOR_F1'
 where role = 'OPERADOR';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2', 'VISUALIZADOR'));

-- -------------------------------------------------------------
-- 2) Defaults: coluna + trigger de criação de conta
-- -------------------------------------------------------------
alter table public.profiles alter column role set default 'OPERADOR_F1';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    'OPERADOR_F1'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -------------------------------------------------------------
-- 3) RLS de produção: os dois operadores executam processo
--    (idêntico ao antigo OPERADOR em 002_rls.sql)
-- -------------------------------------------------------------
drop policy if exists "production_processes_insert" on public.production_processes;
create policy "production_processes_insert" on public.production_processes
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2']));

drop policy if exists "production_processes_update" on public.production_processes;
create policy "production_processes_update" on public.production_processes
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2']))
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2']));

drop policy if exists "production_events_insert" on public.production_events;
create policy "production_events_insert" on public.production_events
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2'])
  );

-- -------------------------------------------------------------
-- 4) refresh_order_statuses (redefinição da 013 com os papéis novos)
--
-- SECURITY DEFINER: a derivação roda durante a atualização de um
-- processo (Fábrica 1/2/Gestão) e os operadores têm
-- production.update_status, mas a RLS de order_items/orders é só
-- ADMIN/GESTOR — sem esta RPC o status derivado falhava com 42501.
-- -------------------------------------------------------------
create or replace function public.refresh_order_statuses(
  p_item_id uuid,
  p_item_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_status text;
  v_next text;
begin
  if not public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2']) then
    raise exception 'Sem permissão para atualizar o status do item.';
  end if;

  if p_item_status not in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO') then
    raise exception 'Status de item inválido: %', p_item_status;
  end if;

  update public.order_items
     set status = p_item_status, updated_at = now()
   where id = p_item_id;

  if not found then
    raise exception 'Item de pedido não encontrado.';
  end if;

  select oi.order_id, o.status
    into v_order_id, v_order_status
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.id = p_item_id;

  if v_order_status = 'CANCELADO' then
    return;
  end if;

  -- Mesma precedência de deriveOrderStatus (camada de serviço):
  -- todos concluídos -> CONCLUIDO; algum em produção -> EM_PRODUCAO; senão Em espera.
  select case
           when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
           when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
           else 'PLANEJADO'
         end
    into v_next
    from public.order_items oi
   where oi.order_id = v_order_id;

  if v_next is distinct from v_order_status then
    update public.orders set status = v_next, updated_at = now() where id = v_order_id;
  end if;
end;
$$;

-- Grants preservados (create or replace não os altera; declarado por
-- completude, igual à 013).
revoke execute on function public.refresh_order_statuses(uuid, text) from anon;
grant execute on function public.refresh_order_statuses(uuid, text) to authenticated;
