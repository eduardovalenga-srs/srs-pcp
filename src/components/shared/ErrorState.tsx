"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** Estado de erro padrão das telas (com ação de tentar novamente). */
export function ErrorState({ title = "Algo deu errado", message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded border border-destructive/40 bg-destructive/5 px-6 py-12 text-center"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="h-4 w-4" aria-hidden />
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
