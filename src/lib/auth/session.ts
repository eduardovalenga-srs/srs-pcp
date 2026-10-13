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
 * Estado da sessão, distinguindo os motivos de "não logado":
 *  - "anonimo"    não há JWT válido (ou a API do Auth falhou);
 *  - "sem-perfil" há JWT, mas nenhuma linha em `profiles` (usuário criado
 *                  sem o trigger handle_new_user / migração ausente);
 *  - "inativo"    há JWT e perfil, mas `active = false` (migração 012);
 *  - "ok"         sessão plenamente válida para a app.
 *
 * O guard do dashboard usa os estados para NÃO entrar em loop de redirect:
 * "anonimo" vai ao /login; "sem-perfil"/"inativo" caem numa rota terminal
 * (/acesso-negado) com saída, em vez de ping-pong /login ↔ painel.
 */
export type SessionState =
  | { status: "anonimo" }
  | { status: "sem-perfil" }
  | { status: "inativo" }
  | { status: "ok"; user: SessionUser };

/** Estado da sessão, memorizado por request. */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();

  // 024: getClaims valida o JWT localmente (sem round-trip ao servidor de
  // auth, como fazia auth.getUser) e devolve o mesmo sub/email do token.
  const {
    data,
    error: claimsError,
  } = await supabase.auth.getClaims();

  if (claimsError || !data?.claims.sub) return { status: "anonimo" };
  const claims = data.claims;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", claims.sub)
    .maybeSingle();

  if (profileError || !profile) {
    // Sem perfil (RLS/user recém-criado): sessão inválida para a app.
    return { status: "sem-perfil" };
  }

  if (!profile.active) {
    // Conta desativada (migração 012): a sessão deixa de valer na hora.
    return { status: "inativo" };
  }

  return {
    status: "ok",
    user: {
      id: claims.sub,
      email: (typeof claims.email === "string" ? claims.email : null) ?? profile.email ?? "",
      profile,
      role: profile.role,
    },
  };
});

/**
 * Usuário autenticado + perfil (role), memorizado por request.
 * Retorna null quando não há sessão válida.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const state = await getSessionState();
  return state.status === "ok" ? state.user : null;
});

/** Lança erro quando não há sessão — usado em Server Actions. */
export async function requireSessionUser(): Promise<SessionUser> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new Error("Sessão expirada. Entre novamente.");
  }
  return sessionUser;
}
