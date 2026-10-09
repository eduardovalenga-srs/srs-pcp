import "server-only";

import { redirect } from "next/navigation";

import { getSessionState, type SessionUser } from "@/lib/auth/session";

/**
 * Guard do layout do dashboard — ANTI-LOOP (ERR_TOO_MANY_REDIRECTS).
 *
 * O middleware (proxy) só olha o JWT do Supabase, que continua válido
 * quando a app rejeita o usuário (sem perfil em `profiles` ou conta
 * desativada). Redirecionar esse estado ao /login criaria ping-pong
 * infinito: /login → painel → /login → … Então:
 *
 *  - "anonimo"    → /login (fluxo normal);
 *  - "sem-perfil" → /acesso-negado (rota terminal com saída);
 *  - "inativo"    → /acesso-negado (rota terminal com saída);
 *  - "ok"         → segue o conteúdo (devolve o usuário da sessão).
 */
export async function DashboardLayoutGuard(): Promise<SessionUser> {
  const sessionState = await getSessionState();
  if (sessionState.status === "anonimo") redirect("/login");
  if (sessionState.status !== "ok") redirect("/acesso-negado");
  return sessionState.user;
}
