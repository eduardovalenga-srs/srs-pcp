import "server-only";

import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  permissionAllowedForAccountType,
  roleDefaultPermissions,
  type AccessContext,
  type AccountType,
  type PermissionKey,
} from "@/lib/auth/access";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { ProfileRow } from "@/lib/types/database";

interface AccessContextPayload {
  accountType?: string;
  permissions?: string[];
  companyCodes?: string[];
  clientIds?: string[];
}

/**
 * Carrega o contexto de acesso efetivo do usuário (perfil-modelo,
 * overrides e escopos) via RPC `security definer` da migration 101.
 *
 * Em caso de falha, aplica o fallback legado por papel — nunca concede
 * mais do que o papel já concedia e nunca assume escopo global externo.
 */
export async function loadAccessContext(
  client: SupabaseServer,
  profile: Pick<ProfileRow, "id" | "role"> & { account_type?: AccountType | null },
): Promise<AccessContext> {
  const fallbackAccountType: AccountType = profile.account_type ?? "INTERNAL";

  const fallback = (): AccessContext => ({
    accountType: fallbackAccountType,
    permissions: roleDefaultPermissions(profile.role).filter((key) =>
      permissionAllowedForAccountType(key, fallbackAccountType),
    ),
    companyCodes: [],
    clientIds: [],
  });

  let data: unknown;
  try {
    const result = await client.rpc("current_profile_access_context");
    if (result.error) {
      console.error("[loadAccessContext]", result.error.message);
      return fallback();
    }
    data = result.data;
  } catch (error) {
    // RPC ausente (migration 101 ainda não aplicada) ou client de teste.
    console.error("[loadAccessContext]", error);
    return fallback();
  }

  const payload = (data ?? {}) as AccessContextPayload;
  const accountType: AccountType =
    payload.accountType === "EXTERNAL" ? "EXTERNAL" : fallbackAccountType;

  const permissions = new Set<PermissionKey>();
  for (const raw of payload.permissions ?? []) {
    if (!isPermissionKey(raw)) continue;
    if (!permissionAllowedForAccountType(raw, accountType)) continue;
    permissions.add(raw);
  }

  // ADMIN continua com acesso total, independentemente de overrides.
  if (profile.role === "ADMIN") {
    for (const key of ALL_PERMISSION_KEYS) {
      if (permissionAllowedForAccountType(key, accountType)) permissions.add(key);
    }
  }

  return {
    accountType,
    permissions: [...permissions],
    companyCodes: Array.isArray(payload.companyCodes) ? payload.companyCodes : [],
    clientIds: Array.isArray(payload.clientIds) ? payload.clientIds : [],
  };
}
