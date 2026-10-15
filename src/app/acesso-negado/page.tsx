import { redirect } from "next/navigation";

import { homePathFor } from "@/lib/auth/permissions";
import { getSessionState } from "@/lib/auth/session";
import { LogoutButton } from "@/components/auth/LogoutButton";

export const metadata = { title: "Acesso negado" };

/**
 * Rota TERMINAL para sessão que a app rejeita (usuário sem perfil em
 * `profiles` ou conta desativada). O middleware do Supabase só olha o
 * JWT — que continua válido — então redirecionar de volta ao /login
 * criaria loop infinito (o /login mandaria ao painel, o layout de volta
 * ao /login…). Aqui o fluxo encerra com saída explícita.
 */
export default async function AcessoNegadoPage() {
  const sessionState = await getSessionState();

  // Estados que não devem parar aqui: segue o fluxo normal.
  if (sessionState.status === "anonimo") redirect("/login");
  if (sessionState.status === "ok") redirect(homePathFor(sessionState.user.role));

  const message =
    sessionState.status === "inativo"
      ? "Sua conta foi desativada. Contate o administrador do sistema."
      : "Seu usuário não possui perfil cadastrado no sistema. Contate o administrador para solicitar o acesso.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1B2A5E]">Acesso negado</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sua sessão foi encerrada por segurança. Entre novamente após a regularização.
        </p>
        <div className="mt-6 flex justify-center">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
