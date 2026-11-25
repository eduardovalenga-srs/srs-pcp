import "server-only";

import { hasPermission, type PermissionKey } from "@/lib/auth/access";
import { type Capability } from "@/lib/auth/permissions";
import { requireSessionUser, type SessionUser } from "@/lib/auth/session";

/**
 * Verifica a capacidade legada do usuário atual.
 * Lança erro tratável (retornado como { error } nas Server Actions).
 */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const sessionUser = await requireSessionUser();
  if (!hasPermission(sessionUser.access, capability)) {
    throw new Error("Você não tem permissão para executar esta ação.");
  }
  return sessionUser;
}

/**
 * Verifica uma permissão efetiva (migration 101). É a forma recomendada
 * para telas/ações personalizáveis — a interface nunca é a autoridade.
 */
export async function requirePermission(permission: PermissionKey): Promise<SessionUser> {
  const sessionUser = await requireSessionUser();
  if (!hasPermission(sessionUser.access, permission)) {
    throw new Error("Você não tem permissão para executar esta ação.");
  }
  return sessionUser;
}
