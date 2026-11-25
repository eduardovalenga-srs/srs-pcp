import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;
});

afterAll(async () => {
  await close();
});

async function addNode(
  parentId: string | null,
  nodeType: "CLIENT" | "LOCATION" | "SHIFT" | "AREA" | "POSITION",
  name: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.employee_allocation_nodes (
       company_code, company_name, parent_id, node_type, name
     ) values ('CLIENTES', 'Clientes', $1, $2, $3)
     returning id`,
    [parentId, nodeType, name],
  );
  return rows[0].id;
}

async function addEmployee(
  companyCode: "750" | "752",
  registration: string,
  name: string,
  positionId: string | null,
  registeredClient: string | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.employees (
       company_code, company_name, registration, name, allocation_position_id, registered_client
     ) values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      companyCode,
      companyCode === "750" ? "SRS 750" : "SRS 752",
      registration,
      name,
      positionId,
      registeredClient,
    ],
  );
  return rows[0].id;
}

describe("access control (migrations 101+)", () => {
  it("escopa usuários externos ao cliente vinculado e permite apenas criar abaixo dele", async () => {
    await asSuperUser(db);
    const clientA = await addNode(null, "CLIENT", "Brafer");
    const locationA = await addNode(clientA, "LOCATION", "Local A");
    const shiftA = await addNode(locationA, "SHIFT", "Turno A");
    const areaA = await addNode(shiftA, "AREA", "Área A");
    const positionA = await addNode(areaA, "POSITION", "Posição A");

    const clientB = await addNode(null, "CLIENT", "Cliente B");
    const locationB = await addNode(clientB, "LOCATION", "Local B");
    const shiftB = await addNode(locationB, "SHIFT", "Turno B");
    const areaB = await addNode(shiftB, "AREA", "Área B");
    const positionB = await addNode(areaB, "POSITION", "Posição B");

    const employeeA = await addEmployee("752", "EXT-A", "Funcionário Cliente A", positionA);
    const employeeB = await addEmployee("752", "EXT-B", "Funcionário Cliente B", positionB);
    const employeeUnassigned = await addEmployee("752", "EXT-UNASSIGNED", "Funcionário sem posição", null);
    const employeePayrollA = await addEmployee(
      "752",
      "EXT-PAYROLL-A",
      "Funcionário ainda sem alocação",
      null,
      "GERAL / BRÁFER",
    );
    const employeePayrollB = await addEmployee(
      "752",
      "EXT-PAYROLL-B",
      "Funcionário de outro cliente pela folha",
      null,
      "Cliente B",
    );
    const employeePayrollOther = await addEmployee(
      "752",
      "EXT-PAYROLL-AMBIGUOUS",
      "Funcionário de cliente diferente",
      null,
      "Outro Brafer",
    );
    await db.query(
      `insert into public.orders (code, type, customer_name)
       values ('EXTERNAL-ACCESS-TEST', 'OF', 'Interno')`,
    );
    const { rows: vacancyA } = await db.query<{ id: string }>(
      `insert into public.recruitment_vacancies (
         title, department, allocation_client_id
       ) values ('Vaga Brafer', 'Solda', $1)
       returning id`,
      [clientA],
    );
    const { rows: vacancyB } = await db.query<{ id: string }>(
      `insert into public.recruitment_vacancies (
         title, department, allocation_client_id
       ) values ('Vaga Cliente B', 'Montagem', $1)
       returning id`,
      [clientB],
    );
    const { rows: candidateA } = await db.query<{ id: string }>(
      `insert into public.recruitment_candidates (vacancy_id, name, email)
       values ($1, 'Candidata Brafer', 'brafer@example.test')
       returning id`,
      [vacancyA[0].id],
    );
    const { rows: candidateB } = await db.query<{ id: string }>(
      `insert into public.recruitment_candidates (vacancy_id, name, email)
       values ($1, 'Candidato Cliente B', 'client-b@example.test')
       returning id`,
      [vacancyB[0].id],
    );
    const { rows: approvedRoleA } = await db.query<{ id: string }>(
      `insert into public.recruitment_approved_roles (client_id, name)
       values ($1, 'Soldador Brafer') returning id`,
      [clientA],
    );
    const { rows: approvedRoleB } = await db.query<{ id: string }>(
      `insert into public.recruitment_approved_roles (client_id, name)
       values ($1, 'Montador Cliente B') returning id`,
      [clientB],
    );

    // Mesmo uma role legada privilegiada não pode ampliar o escopo externo.
    const externalId = await createUser(db, "external-access@test.local", "ADMIN");
    const externalRecruitmentId = await createUser(db, "external-recruitment@test.local", "OPERADOR_F1");
    await createUser(db, "internal-peer@test.local", "OPERADOR_F1");
    await db.query(`update public.profiles set account_type = 'EXTERNAL' where id in ($1, $2)`, [
      externalId,
      externalRecruitmentId,
    ]);
    await db.query(
      `insert into public.profile_client_access (profile_id, client_node_id)
       values ($1, $2), ($3, $2)`,
      [externalId, clientA, externalRecruitmentId],
    );
    await db.query(
      `insert into public.user_permission_overrides (profile_id, permission_key, allowed)
         values
         ($1, 'rh.allocations.view', true),
         ($1, 'rh.allocations.create_location', true),
         ($2, 'rh.allocations.view', true),
         ($2, 'rh.allocations.create_location', true),
         ($2, 'rh.recruitment.view', true)`,
      [externalId, externalRecruitmentId],
    );

    await asUser(db, "authenticated", externalId);
    const { rows: adminState } = await db.query<{ exists: boolean }>(
      `select public.current_system_has_admin() as exists`,
    );
    expect(adminState[0].exists).toBe(false);
    await expect(
      db.query(`select public.claim_first_admin()`),
    ).rejects.toThrow(/externos não podem reivindicar/i);

    const { rows: permissionChecks } = await db.query<{
      create_location: boolean;
      access_client: boolean;
      external: boolean;
    }>(
      `select
         public.current_profile_has_permission('rh.allocations.create_location') as create_location,
         public.current_profile_can_access_node($1::uuid) as access_client,
         public.current_profile_is_external() as external`,
      [clientA],
    );
    expect(permissionChecks[0]).toEqual({
      create_location: true,
      access_client: true,
      external: true,
    });
    const { rows: policyChecks } = await db.query(
      `select
         public.current_profile_has_permission(
           case 'LOCATION'
             when 'CLIENT' then 'rh.allocations.create_client'
             when 'LOCATION' then 'rh.allocations.create_location'
             when 'SHIFT' then 'rh.allocations.create_shift'
             when 'AREA' then 'rh.allocations.create_area'
             when 'POSITION' then 'rh.allocations.create_position'
             else 'rh.allocations.create_client'
           end
         ) as permitted,
         ('LOCATION' = 'CLIENT'
           or public.current_profile_can_access_node($1::uuid)
           or not public.current_profile_is_external()) as scoped_parent,
         ('LOCATION' <> 'CLIENT'
           or not public.current_profile_is_external()) as not_new_client`,
      [clientA],
    );
    expect(policyChecks[0]).toEqual({
      permitted: true,
      scoped_parent: true,
      not_new_client: true,
    });
    const { rows: visibleEmployees } = await db.query<{ id: string }>(
      `select id from public.employees order by registration`,
    );
    const visibleEmployeeIds = visibleEmployees.map((row) => row.id);
    expect(visibleEmployeeIds).toEqual(expect.arrayContaining([employeeA, employeePayrollA]));
    expect(visibleEmployeeIds).not.toContain(employeeB);
    expect(visibleEmployeeIds).not.toContain(employeeUnassigned);
    expect(visibleEmployeeIds).not.toContain(employeePayrollB);
    expect(visibleEmployeeIds).not.toContain(employeePayrollOther);

    const { rows: hiddenOrders } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.orders where code = 'EXTERNAL-ACCESS-TEST'`,
    );
    expect(hiddenOrders[0].count).toBe(0);
    const { rows: visibleProfiles } = await db.query<{ id: string }>(
      `select id from public.profiles`,
    );
    expect(visibleProfiles.map((row) => row.id)).toEqual([externalId]);

    await asUser(db, "authenticated", externalRecruitmentId);
    const { rows: visibleVacancies } = await db.query<{ id: string }>(
      `select id from public.recruitment_vacancies`,
    );
    expect(visibleVacancies.map((row) => row.id)).toEqual([vacancyA[0].id]);
    const { rows: visibleCandidates } = await db.query<{ id: string }>(
      `select id from public.recruitment_candidates`,
    );
    expect(visibleCandidates.map((row) => row.id)).toEqual([candidateA[0].id]);
    const { rows: visibleApprovedRoles } = await db.query<{ id: string }>(
      `select id from public.recruitment_approved_roles`,
    );
    expect(visibleApprovedRoles.map((row) => row.id)).toEqual([approvedRoleA[0].id]);
    const { rows: linkedRecruitmentClients } = await db.query<{ id: string; name: string; active: boolean }>(
      `select * from public.current_profile_recruitment_clients()`,
    );
    expect(linkedRecruitmentClients).toEqual([
      { id: clientA, name: "Brafer", active: true },
    ]);
    await expect(
      db.query(
        `insert into public.recruitment_candidates (vacancy_id, name)
         values ($1, 'Tentativa externa')`,
        [vacancyA[0].id],
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      db.query(
        `insert into public.recruitment_approved_roles (client_id, name)
         values ($1, 'Cargo criado externamente')`,
        [clientA],
      ),
    ).rejects.toThrow(/row-level security/i);
    expect(candidateB[0].id).not.toBe(candidateA[0].id);
    expect(approvedRoleB[0].id).not.toBe(approvedRoleA[0].id);

    const { rows: visibleNodes } = await db.query<{ id: string }>(
      `select id from public.employee_allocation_nodes`,
    );
    expect(visibleNodes.map((row) => row.id)).toEqual(
      expect.arrayContaining([clientA, locationA, shiftA, areaA, positionA]),
    );
    expect(visibleNodes.map((row) => row.id)).not.toContain(clientB);
    expect(visibleNodes.map((row) => row.id)).not.toContain(locationB);

    const created = await db.query(
      `insert into public.employee_allocation_nodes (
         company_code, company_name, parent_id, node_type, name
       ) values ('CLIENTES', 'Clientes', $1, 'LOCATION', 'Local criado pelo cliente')`,
      [clientA],
    );
    expect(created.affectedRows).toBe(1);

    await expect(
      db.query(
        `insert into public.employee_allocation_nodes (
           company_code, company_name, parent_id, node_type, name
         ) values ('CLIENTES', 'Clientes', $1, 'LOCATION', 'Acesso cruzado')`,
        [clientB],
      ),
    ).rejects.toThrow(/row-level security|item superior não existe/i);

    const updateResult = await db.query(
      `update public.employee_allocation_nodes set name = 'Tentativa de edição' where id = $1`,
      [locationA],
    );
    expect(updateResult.affectedRows).toBe(0);

    await expect(
      db.query(
        `select public.assign_employee_allocation($1::uuid, $2::uuid)`,
        [employeeA, positionA],
      ),
    ).rejects.toThrow(/externos não podem alterar/i);
    await expect(
      db.query(
        `select public.import_employees('[{"company_code":"752","company_name":"SRS","registration":"X","name":"X"}]'::jsonb)`,
      ),
    ).rejects.toThrow(/permissão para importar/i);
  });

  it("aplica o escopo de empresa configurado para usuários internos", async () => {
    await asSuperUser(db);
    const employee750 = await addEmployee("750", "SCOPE-750", "Funcionário 750", null);
    await addEmployee("752", "SCOPE-752", "Funcionário 752", null);
    const { rows: billingRows } = await db.query<{ billing_model: string }>(
      `select billing_model from public.employees where id = $1`,
      [employee750],
    );
    expect(billingRows[0]?.billing_model).toBe("HORA");
    await expect(
      db.query(
        `insert into public.employees (
           company_code, company_name, registration, name, billing_model
         ) values ('750', 'SRS 750', 'INVALID-BILLING', 'Funcionário inválido', 'DIARIA')`,
      ),
    ).rejects.toThrow(/employees_billing_model_valid/i);

    const internalId = await createUser(db, "internal-scope@test.local", "OPERADOR_F1");
    await db.query(
      `insert into public.profile_company_access (profile_id, company_code)
       values ($1, '750')`,
      [internalId],
    );

    await asUser(db, "authenticated", internalId);
    const { rows } = await db.query<{ id: string }>(
      `select id from public.employees where registration like 'SCOPE-%'`,
    );
    expect(rows.map((row) => row.id)).toEqual([employee750]);
  });

  it("respeita grants e denies personalizados também no RLS dos módulos internos", async () => {
    await asSuperUser(db);
    const canCreateId = await createUser(db, "custom-order-create@test.local", "VISUALIZADOR");
    const deniedCreateId = await createUser(db, "denied-order-create@test.local", "VISUALIZADOR");
    await db.query(
      `insert into public.user_permission_overrides (profile_id, permission_key, allowed)
       values ($1, 'orders.create', true)`,
      [canCreateId],
    );

    await asUser(db, "authenticated", canCreateId);
    const { rows: created } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name)
       values ('CUSTOM-ORDER-GRANTED', 'OF', 'Grant') returning id`,
    );
    expect(created).toHaveLength(1);

    await asUser(db, "authenticated", deniedCreateId);
    await expect(
      db.query(
        `insert into public.orders (code, type, customer_name)
         values ('CUSTOM-ORDER-DENIED', 'OF', 'Denied')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("avalia permissões RLS constantes uma vez por consulta (InitPlan)", async () => {
    await asSuperUser(db);
    const adminId = await createUser(db, "initplan-check@test.local", "ADMIN");
    const { rows: permissionPolicy } = await db.query<{ qual: string }>(
      `select qual from pg_policies
        where schemaname = 'public'
          and tablename = 'orders'
          and policyname = 'permission_gate_select'`,
    );
    const { rows: internalPolicy } = await db.query<{ qual: string }>(
      `select qual from pg_policies
        where schemaname = 'public'
          and tablename = 'orders'
          and policyname = 'internal_account_required'`,
    );

    expect(permissionPolicy[0]?.qual).toContain("SELECT current_profile_has_permission");
    expect(internalPolicy[0]?.qual).toContain("SELECT current_profile_is_internal");

    await asUser(db, "authenticated", adminId);
    const { rows: plan } = await db.query<{ "QUERY PLAN": string }>(
      `explain (verbose) select id from public.orders`,
    );
    expect(plan.some((row) => row["QUERY PLAN"].includes("InitPlan"))).toBe(true);
  });

  it("agrega expedição confirmada no banco e bloqueia a RPC para externos", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('SHIP-RPC-TEST', 'OF') returning id`,
    );
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item teste de expedição', 2) returning id`,
      [orderRows[0].id],
    );
    const { rows: receiptRows } = await db.query<{ id: string }>(
      `insert into public.romaneios (order_id, status)
       values ($1, 'CONFIRMADO') returning id`,
      [orderRows[0].id],
    );
    await db.query(
      `insert into public.romaneio_items (romaneio_id, order_item_id, quantity)
       values ($1, $2, 1)`,
      [receiptRows[0].id, itemRows[0].id],
    );

    const internalId = await createUser(db, "shipment-reader@test.local", "OPERADOR_F1");
    await asUser(db, "authenticated", internalId);
    const { rows: totals } = await db.query<{ order_item_id: string; quantity: number | string }>(
      `select * from public.get_confirmed_quantity_by_item_ids(array[$1::uuid])`,
      [itemRows[0].id],
    );
    expect(totals).toHaveLength(1);
    expect(totals[0]?.order_item_id).toBe(itemRows[0].id);
    expect(Number(totals[0]?.quantity)).toBe(1);

    await asSuperUser(db);
    const externalId = await createUser(db, "shipment-external@test.local", "OPERADOR_F1");
    await db.query(
      `update public.profiles set account_type = 'EXTERNAL' where id = $1`,
      [externalId],
    );
    await asUser(db, "authenticated", externalId);
    await expect(
      db.query(
        `select * from public.get_confirmed_quantity_by_item_ids(array[$1::uuid])`,
        [itemRows[0].id],
      ),
    ).rejects.toThrow(/externos não podem consultar dados de expedição/i);
  });
});
