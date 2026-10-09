"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Fronteira de erro do App Router: sem ela, exceções de guard (permissão,
 * sessão) em produção viravam página branca sem mensagem (caso do
 * OPERADOR caindo em /gestao-entregas antes do redirect por papel).
 */
export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  const denied = error.message.includes("permissão");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold text-foreground">
          {denied ? "Acesso negado" : "Algo deu errado"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {denied
            ? "Seu perfil não tem permissão para acessar esta página."
            : error.message || "Tente novamente. Se o problema continuar, contate o administrador."}
        </p>
        {error.digest ? <p className="text-xs text-muted-foreground">Código: {error.digest}</p> : null}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={reset}>
          Tentar novamente
        </Button>
        <Button type="button" asChild>
          <Link href="/">Ir para o início</Link>
        </Button>
      </div>
    </main>
  );
}
