import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/constants/orders";
import type { ProfileRow } from "@/lib/types/database";

export interface SessionUser {
  id: string;
  email: string;
  profile: ProfileRow;
  role: Role;
}

/**
 * Usuário autenticado + perfil (role), memorizado por request.
 * Retorna null quando não há sessão válida.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    // Sem perfil (RLS/user recém-criado): sessão inválida para a app.
    return null;
  }

  if (!profile.active) {
    // Conta desativada (migração 012): a sessão deixa de valer na hora.
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? profile.email ?? "",
    profile,
    role: profile.role,
  };
});

/** Lança erro quando não há sessão — usado em Server Actions. */
export async function requireSessionUser(): Promise<SessionUser> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new Error("Sessão expirada. Entre novamente.");
  }
  return sessionUser;
}
