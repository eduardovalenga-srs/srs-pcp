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
  const adminExists = await hasAdmin(supabase).catch(() => true);

  const user = {
    name: sessionUser.profile.name ?? sessionUser.email,
    email: sessionUser.email,
    role: sessionUser.role,
  };

  // 043: navegação lateral. No desktop a sidebar fixa ocupa a coluna da
  // esquerda e o conteúdo fica ao lado; abaixo de lg a sidebar some e a
  // MobileTopBar assume (botão de menu abre o mesmo itens num drawer).
  return (
    <div className="flex min-h-screen bg-background">
      <ForceReauth />
      <AppSidebar user={user} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar user={user} />

        <main className="mx-auto w-full flex-1 p-3 sm:p-4 lg:p-5">
          {sessionUser.profile.must_change_password ? <PasswordBanner /> : null}
          {!adminExists ? <AdminClaimBanner /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}
