import "server-only";

import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  permissionAllowedForAccountType,
  type AccessConfig,
  type AccountType,
  type PermissionKey,
} from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { RoleValue } from "@/lib/types/database";
import { assertOk } from "@/lib/utils/supabase-result";

/**
 * Leitura/gravação da configuração de acesso personalizado (migration 101).
 *
 * As tabelas de configuração só têm SELECT para ADMIN (RLS) e nenhuma
 * policy de escrita — toda alteração passa pelo client service-role,
 * sempre depois de `requireCapability("users.manage")`.
 */

export interface AccessProfileSummary {
  id: string;
  name: string;
  roleKey: string | null;
  accountType: AccountType;
  permissions: PermissionKey[];
}

export interface ClientRootOption {
  id: string;
  name: string;
}

export interface UserAccessSummary {
  accountType: AccountType;
  accessProfileId: string | null;
  permissions: PermissionKey[];
  clientIds: string[];
  companyCodes: string[];
}

export interface AccessAuditEntry {
  id: string;
  actorProfileId: string | null;
  targetProfileId: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

function toPermissionList(
  values: Iterable<string> | null | undefined,
  accountType: AccountType,
) {
  const permissions = new Set<PermissionKey>();
  for (const value of values ?? []) {
    if (!isPermissionKey(value)) continue;
    if (!permissionAllowedForAccountType(value, accountType)) continue;
    permissions.add(value);
  }
  return [...permissions];
}

/** Perfis-modelo (derivados dos papéis) e suas permissões. */
export async function listAccessProfiles(client: SupabaseServer): Promise<AccessProfileSummary[]> {
  const [profilesResult, permissionsResult] = await Promise.all([
    client.from("access_profiles").select("id, name, role_key, account_type").order("name"),
    client.from("access_profile_permissions").select("access_profile_id, permission_key"),
  ]);

  assertOk(profilesResult.error, "Não foi possível carregar os perfis de acesso");
  assertOk(permissionsResult.error, "Não foi possível carregar as permissões dos perfis");

  const permissionsByProfile = new Map<string, string[]>();
  for (const row of permissionsResult.data ?? []) {
    const list = permissionsByProfile.get(row.access_profile_id) ?? [];
    list.push(row.permission_key);
    permissionsByProfile.set(row.access_profile_id, list);
  }

  return (profilesResult.data ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    roleKey: profile.role_key,
    accountType: profile.account_type,
    permissions: toPermissionList(permissionsByProfile.get(profile.id), profile.account_type),
  }));
}

/** Raízes CLIENT disponíveis para vincular usuários externos. */
export async function listClientRoots(client: SupabaseServer): Promise<ClientRootOption[]> {
  const { data, error } = await client
    .from("employee_allocation_nodes")
    .select("id, name")
    .eq("node_type", "CLIENT")
    .is("parent_id", null)
    .order("name", { ascending: true });

  assertOk(error, "Não foi possível carregar os clientes");
  return (data ?? []).map((node) => ({ id: node.id, name: node.name }));
}

export async function listRecentAccessAudit(
  client: SupabaseServer,
  limit = 25,
): Promise<AccessAuditEntry[]> {
  const { data, error } = await client
    .from("access_audit_log")
    .select("id, actor_profile_id, target_profile_id, action, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  assertOk(error, "Não foi possível carregar a auditoria de acessos");
  return (data ?? []).map((entry) => ({
    id: entry.id,
    actorProfileId: entry.actor_profile_id,
    targetProfileId: entry.target_profile_id,
    action: entry.action,
    details: (entry.details ?? {}) as Record<string, unknown>,
    createdAt: entry.created_at,
  }));
}

/**
 * Contexto de acesso efetivo de todos os usuários, para a tela de
 * configurações. Carrega as tabelas pequenas de uma vez (sem N+1).
 */
export async function listUserAccessSummaries(
  client: SupabaseServer,
): Promise<Map<string, UserAccessSummary>> {
  const [profilesResult, profilePermissionsResult, overridesResult, clientsResult, companiesResult] =
    await Promise.all([
      client.from("profiles").select("id, role, account_type, access_profile_id"),
      client.from("access_profile_permissions").select("access_profile_id, permission_key"),
      client.from("user_permission_overrides").select("profile_id, permission_key, allowed"),
      client.from("profile_client_access").select("profile_id, client_node_id"),
      client.from("profile_company_access").select("profile_id, company_code"),
    ]);

  assertOk(profilesResult.error, "Não foi possível carregar os acessos dos usuários");
  assertOk(profilePermissionsResult.error, "Não foi possível carregar as permissões");
  assertOk(overridesResult.error, "Não foi possível carregar os ajustes de permissão");
  assertOk(clientsResult.error, "Não foi possível carregar os clientes vinculados");
  assertOk(companiesResult.error, "Não foi possível carregar as empresas vinculadas");

  const defaultsByProfile = new Map<string, string[]>();
  for (const row of profilePermissionsResult.data ?? []) {
    const list = defaultsByProfile.get(row.access_profile_id) ?? [];
    list.push(row.permission_key);
    defaultsByProfile.set(row.access_profile_id, list);
  }

  const overridesByUser = new Map<string, Map<string, boolean>>();
  for (const row of overridesResult.data ?? []) {
    const map = overridesByUser.get(row.profile_id) ?? new Map<string, boolean>();
    map.set(row.permission_key, row.allowed);
    overridesByUser.set(row.profile_id, map);
  }

  const clientsByUser = new Map<string, string[]>();
  for (const row of clientsResult.data ?? []) {
    const list = clientsByUser.get(row.profile_id) ?? [];
    list.push(row.client_node_id);
    clientsByUser.set(row.profile_id, list);
  }

  const companiesByUser = new Map<string, string[]>();
  for (const row of companiesResult.data ?? []) {
    const list = companiesByUser.get(row.profile_id) ?? [];
    list.push(row.company_code);
    companiesByUser.set(row.profile_id, list);
  }

  const summaries = new Map<string, UserAccessSummary>();
  for (const profile of profilesResult.data ?? []) {
    const accountType: AccountType = profile.account_type ?? "INTERNAL";
    const overrides = overridesByUser.get(profile.id);
    const effective = new Set<string>(
      profile.role === ("ADMIN" satisfies RoleValue)
        ? ALL_PERMISSION_KEYS
        : (defaultsByProfile.get(profile.access_profile_id ?? "") ?? []),
    );

    if (profile.role !== "ADMIN" && overrides) {
      for (const [key, allowed] of overrides) {
        if (allowed) effective.add(key);
        else effective.delete(key);
      }
    }

    summaries.set(profile.id, {
      accountType,
      accessProfileId: profile.access_profile_id,
      permissions: toPermissionList(effective, accountType),
      clientIds: clientsByUser.get(profile.id) ?? [],
      companyCodes: companiesByUser.get(profile.id) ?? [],
    });
  }

  return summaries;
}

/**
 * Salva a configuração efetiva do usuário.
 *
 * As permissões são gravadas como overrides em relação ao perfil-modelo,
 * de modo que o conjunto final seja exatamente o escolhido no editor —
 * inclusive quando o perfil-modelo mudar depois.
 */
export async function saveUserAccessConfig(
  profileId: string,
  actorProfileId: string,
  config: AccessConfig,
): Promise<void> {
  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, access_profile_id")
    .eq("id", profileId)
    .maybeSingle();
  assertOk(profileError, "Não foi possível carregar o usuário");
  if (!profile) throw new Error("Usuário não encontrado.");

  if (profile.role === "ADMIN" && config.accountType !== "INTERNAL") {
    throw new Error("A conta de administrador deve permanecer interna.");
  }

  if (
    profile.role !== "ADMIN" &&
    (config.permissions.includes("users.manage") || config.permissions.includes("settings.manage"))
  ) {
    throw new Error("Somente administradores podem receber acesso ao gerenciamento de usuários.");
  }

  if (config.accountType === "EXTERNAL" && config.clientIds.length > 0) {
    const { data: clientNodes, error: clientsError } = await admin
      .from("employee_allocation_nodes")
      .select("id")
      .in("id", config.clientIds)
      .eq("node_type", "CLIENT")
      .is("parent_id", null);
    assertOk(clientsError, "Não foi possível validar os clientes selecionados");
    if ((clientNodes ?? []).length !== config.clientIds.length) {
      throw new Error("Selecione somente clientes válidos da raiz da árvore.");
    }
  }

  const invalidCompanies = config.companyCodes.filter((code) => !["750", "752"].includes(code));
  if (invalidCompanies.length > 0) {
    throw new Error("Uma ou mais empresas selecionadas são inválidas.");
  }

  const defaults = new Set<string>();
  if (profile.access_profile_id) {
    const { data: permissions, error: permissionsError } = await admin
      .from("access_profile_permissions")
      .select("permission_key")
      .eq("access_profile_id", profile.access_profile_id);
    assertOk(permissionsError, "Não foi possível carregar as permissões do perfil");
    for (const row of permissions ?? []) defaults.add(row.permission_key);
  }

  const desired = new Set<string>(
    config.permissions.filter((key) => permissionAllowedForAccountType(key, config.accountType)),
  );
  const overrides: { profile_id: string; permission_key: string; allowed: boolean }[] = [];
  for (const key of desired) {
    if (!defaults.has(key)) overrides.push({ profile_id: profileId, permission_key: key, allowed: true });
  }
  for (const key of defaults) {
    if (!desired.has(key)) overrides.push({ profile_id: profileId, permission_key: key, allowed: false });
  }

  const { error: accountError } = await admin
    .from("profiles")
    .update({ account_type: config.accountType })
    .eq("id", profileId);
  assertOk(accountError, "Não foi possível atualizar o tipo de conta");

  const { error: clearOverridesError } = await admin
    .from("user_permission_overrides")
    .delete()
    .eq("profile_id", profileId);
  assertOk(clearOverridesError, "Não foi possível limpar os ajustes de permissão");

  if (overrides.length > 0) {
    const { error: insertOverridesError } = await admin
      .from("user_permission_overrides")
      .insert(overrides);
    assertOk(insertOverridesError, "Não foi possível salvar os ajustes de permissão");
  }

  const { error: clearClientsError } = await admin
    .from("profile_client_access")
    .delete()
    .eq("profile_id", profileId);
  assertOk(clearClientsError, "Não foi possível limpar os clientes vinculados");

  if (config.accountType === "EXTERNAL" && config.clientIds.length > 0) {
    const { error: insertClientsError } = await admin.from("profile_client_access").insert(
      config.clientIds.map((clientId) => ({
        profile_id: profileId,
        client_node_id: clientId,
      })),
    );
    assertOk(insertClientsError, "Não foi possível salvar os clientes vinculados");
  }

  const { error: clearCompaniesError } = await admin
    .from("profile_company_access")
    .delete()
    .eq("profile_id", profileId);
  assertOk(clearCompaniesError, "Não foi possível limpar as empresas vinculadas");

  if (config.accountType === "INTERNAL" && config.companyCodes.length > 0) {
    const { error: insertCompaniesError } = await admin.from("profile_company_access").insert(
      config.companyCodes.map((companyCode) => ({
        profile_id: profileId,
        company_code: companyCode,
      })),
    );
    assertOk(insertCompaniesError, "Não foi possível salvar as empresas vinculadas");
  }

  await writeAccessAuditLog(actorProfileId, profileId, "ACCESS_CONFIG_UPDATED", {
      accountType: config.accountType,
      permissions: config.permissions,
      clientIds: config.clientIds,
      companyCodes: config.companyCodes,
  });
}

/** Role changes return to the new template; the admin can customize again. */
export async function resetUserPermissionOverrides(profileId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_permission_overrides")
    .delete()
    .eq("profile_id", profileId);
  assertOk(error, "Não foi possível reaplicar o perfil-modelo de acesso");
}

export async function writeAccessAuditLog(
  actorProfileId: string,
  targetProfileId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("access_audit_log").insert({
    actor_profile_id: actorProfileId,
    target_profile_id: targetProfileId,
    action,
    details: details as import("@/lib/types/database").Json,
  });
  assertOk(error, "Não foi possível registrar a auditoria de acesso");
}
