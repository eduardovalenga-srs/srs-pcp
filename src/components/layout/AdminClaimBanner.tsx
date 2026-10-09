import { ShieldCheck } from "lucide-react";

import { claimFirstAdminAction } from "@/lib/actions/settings.actions";
import { Button } from "@/components/ui/button";

/**
 * Aviso exibido quando ainda não existe nenhum administrador.
 * Permite que o primeiro usuário se torne ADMIN sem SQL manual.
 */
export async function AdminClaimBanner() {
  async function claim() {
    "use server";
    await claimFirstAdminAction();
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-status-progress-bg bg-status-progress-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-progress" aria-hidden />
        <p className="text-foreground">
          <strong>Primeiro acesso:</strong> ainda não existe administrador. Torne-se administrador para
          gerenciar usuários, processos e importações.
        </p>
      </div>
      <form action={claim}>
        <Button type="submit" size="sm" variant="secondary">
          Tornar-se administrador
        </Button>
      </form>
    </div>
  );
}
