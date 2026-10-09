import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasAdmin } from "@/lib/repositories/profiles.repository";
import { AdminClaimBanner } from "@/components/layout/AdminClaimBanner";
import { PasswordBanner } from "@/components/layout/PasswordBanner";
import { TopNav } from "@/components/layout/TopNav";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

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
