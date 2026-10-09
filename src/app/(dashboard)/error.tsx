"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/shared/ErrorState";

/**
 * Boundary de erro do painel: nenhuma tela do app fica em branco.
 * `reset` recarrega apenas a rota atual.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="Erro ao carregar a página"
      message={error.message || "Ocorreu um erro inesperado. Tente novamente."}
      onRetry={reset}
    />
  );
}
