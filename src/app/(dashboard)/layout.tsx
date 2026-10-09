import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { hasAdmin } from "@/lib/repositories/profiles.repository";
import { DashboardLayoutGuard } from "./layout-guard";
import { AdminClaimBanner } from "@/components/layout/AdminClaimBanner";
import { PasswordBanner } from "@/components/layout/PasswordBanner";
import { TopNav } from "@/components/layout/TopNav";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Guard anti-loop (ver layout-guard.ts): sessão que a app rejeita cai em
  // /acesso-negado em vez de ping-pong /login ↔ painel. Sessão ok devolve
  // o usuário (memorizado por request via React cache).
  const sessionUser = await DashboardLayoutGuard();

  const supabase = await createClient();
  const adminExists = await hasAdmin(supabase).catch(() => true);

  return (
    <div className="min-h-screen bg-background">
      <TopNav
        user={{
          name: sessionUser.profile.name ?? sessionUser.email,
          email: sessionUser.email,
          role: sessionUser.role,
        }}
      />

      {/* Nav sticky em fluxo: o conteúdo simplesmente começa abaixo dela (sem pt/pl fixos). */}
      <main className="mx-auto w-full p-3 sm:p-4 lg:p-5">
        {sessionUser.profile.must_change_password ? <PasswordBanner /> : null}
        {!adminExists ? <AdminClaimBanner /> : null}
        {children}
      </main>
    </div>
  );
}
