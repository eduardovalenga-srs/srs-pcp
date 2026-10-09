import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

interface AccessDeniedProps {
  message?: string;
}

/** Bloco exibido quando o perfil não tem permissão para a tela. */
export function AccessDenied({ message = "Seu perfil não tem permissão para acessar esta área." }: AccessDeniedProps) {
  return (
    <EmptyState
      icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
      title="Acesso restrito"
      description={`${message} Fale com um administrador para revisar sua permissão.`}
    />
  );
}
