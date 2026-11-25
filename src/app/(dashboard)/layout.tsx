import type { ReactNode } from "react";

import { hasAdmin } from "@/lib/repositories/profiles.repository";
import { createClient } from "@/lib/supabase/server";
import { AdminClaimBanner } from "@/components/layout/AdminClaimBanner";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { PasswordBanner } from "@/components/layout/PasswordBanner";
import { ForceReauth } from "@/components/auth/ForceReauth";
import { DashboardLayoutGuard } from "./layout-guard";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Guard anti-loop (ver layout-guard.ts): sessão que a app rejeita cai em
  // /acesso-negado em vez de ping-pong /login ↔ painel. Sessão ok devolve
  // o usuário (memorizado por request via React cache).
  const sessionUser = await DashboardLayoutGuard();

  const supabase = await createClient();
  const isInternal = sessionUser.access.accountType === "INTERNAL";
  // Contas externas não devem depender de visibilidade sobre a tabela
  // profiles para decidir se existe administrador, nem podem reivindicá-lo.
  const adminExists = isInternal ? await hasAdmin(supabase).catch(() => true) : true;
  const showClaimFirstAdmin = isInternal && !adminExists;

  const user = {
    name: sessionUser.profile.name ?? sessionUser.email,
    email: sessionUser.email,
    role: sessionUser.role,
    permissions: sessionUser.access.permissions,
    accountType: sessionUser.access.accountType,
  };

  // 084: shell de altura fixa. O documento não rola mais — a sidebar
  // (desktop) e a barra superior (mobile) ficam sempre visíveis e só a
  // área de conteúdo rola. As telas de lista usam `ListPage` para deixar
  // filtros/resumo parados e rolar apenas o quadro da lista, com a
  // paginação fixa no rodapé.
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <ForceReauth />
      <AppSidebar user={user} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileTopBar user={user} />

        <main className="flex min-h-0 flex-1 flex-col p-3 sm:p-4 lg:p-5">
          {sessionUser.profile.must_change_password || showClaimFirstAdmin ? (
            <div className="shrink-0">
              {sessionUser.profile.must_change_password ? <PasswordBanner /> : null}
              {showClaimFirstAdmin ? <AdminClaimBanner /> : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
