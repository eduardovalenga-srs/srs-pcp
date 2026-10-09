import { redirect } from "next/navigation";
import Image from "next/image";

import { getSessionUser } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/permissions";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Entrar · Imperatriz" };

export default async function LoginPage() {
  // Já autenticado? Segue direto para o painel.
  const sessionUser = await getSessionUser();
  if (sessionUser) redirect(homePathFor(sessionUser.role));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center">
          <Image
            src="/logo_imperatriz.png"
            alt="Brasão Imperatriz"
            width={200}
            height={200}
            priority
            className="h-auto w-[min(200px,55%)]"
          />
          <h1 className="mt-4 text-5xl font-black tracking-tight text-[#1B2A5E]">IMPERATRIZ</h1>
          <p className="mt-1 text-center text-xs font-bold uppercase tracking-[0.12em] text-[#1B2A5E] md:text-sm">
            Sistema de Gestão Corporativa
          </p>
        </div>

        <LoginForm />

        <div className="mt-10 flex justify-center">
          <Image
            src="/logo.png"
            alt="SRS Prestadora de Serviços"
            width={200}
            height={76}
            className="h-auto w-[min(200px,60%)]"
          />
        </div>

        <p className="mt-6 text-center text-sm font-medium text-[#1B2A5E]">
          Software de Gestão de Fábricas&nbsp;|&nbsp;© 2025 SRS – Corp
        </p>
      </div>
    </main>
  );
}
