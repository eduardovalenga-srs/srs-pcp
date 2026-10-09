import "server-only";

import { can, type Capability } from "@/lib/auth/permissions";
import { requireSessionUser, type SessionUser } from "@/lib/auth/session";

/**
 * Verifica a capacidade do usuário atual.
 * Lança erro tratável (retornado como { error } nas Server Actions).
 */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const sessionUser = await requireSessionUser();
  if (!can(sessionUser.role, capability)) {
    throw new Error("Você não tem permissão para executar esta ação.");
  }
  return sessionUser;
}
