import { KeyRound } from "lucide-react";

import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";

/**
 * Aviso persistente enquanto a conta tem senha temporária
 * (`must_change_password`, migração 012) — some sozinha após a troca.
 */
export function PasswordBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-3 rounded-md border border-status-progress-bg bg-status-progress-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2 text-sm">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-status-progress" aria-hidden />
        <p className="text-foreground">
          <strong>Senha temporária:</strong> você entrou com a senha gerada pelo administrador.
          Defina a sua própria senha para continuar com segurança.
        </p>
      </div>
      <ChangePasswordDialog
        label="Definir minha senha"
        variant="secondary"
        className="self-start sm:self-auto"
      />
    </div>
  );
}
