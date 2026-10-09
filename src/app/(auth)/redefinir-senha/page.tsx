import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Redefinir senha · Controle de Produção" };

/**
 * Destino do link de recuperação ("Esqueci minha senha" e link gerado
 * pelo administrador). O `?code=` do PKCE é trocado por sessão no
 * cliente; sem código (link expirado/inválido) mostra o erro + volta.
 */
export default async function RedefinirSenhaPage({
  searchParams,
}: PageProps<"/redefinir-senha">) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : null;
  const errorDescription =
    typeof params.error_description === "string" ? params.error_description : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Redefinir senha</h1>
          <p className="text-sm text-muted-foreground">Controle de Produção · Serralheria</p>
        </div>

        {code ? (
          <ResetPasswordForm code={code} />
        ) : (
          <div className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
            <p className="text-sm text-destructive">
              Não foi possível abrir o link de redefinição
              {errorDescription ? `: ${errorDescription}` : "."} O link pode ter expirado —
              solicite um novo em “Esqueci minha senha”.
            </p>
            <Button type="button" variant="outline" size="sm" className="w-full" asChild>
              <Link href="/login">Voltar para o login</Link>
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
