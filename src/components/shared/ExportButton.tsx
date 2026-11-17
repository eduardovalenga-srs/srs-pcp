"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  /** Rota da exportação (ex.: "/api/export/fabrica-2"). */
  endpoint: string;
  /** Nome do arquivo quando a resposta não vier com Content-Disposition. */
  fallbackFileName: string;
  /**
   * Filtros adicionais enviados na query string. Útil quando o estado da
   * tela não vive na URL (dashboard): sobrescreve as chaves informadas e
   * preserva o restante da query atual.
   */
  params?: Record<string, string | number | null | undefined>;
  /** Bloqueia o clique (ex.: painel carregando ou sem dados). */
  disabled?: boolean;
}

/** Extrai o filename do header Content-Disposition (`attachment; filename="..."`). */
function fileNameFrom(header: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(header ?? "");
  return match?.[1] ?? fallback;
}

/**
 * Baixa a lista atual da tela em .xlsx. Envia a query string da URL junto,
 * então a planilha espelha os FILTROS vigentes — a lista inteira, não só a
 * página visível.
 */
export function ExportButton({ endpoint, fallbackFileName, params, disabled = false }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const search = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value === null || value === undefined || value === "") search.delete(key);
        else search.set(key, String(value));
      }
      const query = search.toString();
      const response = await fetch(query ? `${endpoint}?${query}` : endpoint, { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(payload?.error ?? "Não foi possível exportar a lista.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameFrom(response.headers.get("Content-Disposition"), fallbackFileName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Planilha exportada.");
    } catch {
      toast.error("Não foi possível exportar a lista.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleExport()} disabled={disabled || busy}>
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
      {busy ? "Exportando…" : "Exportar Excel"}
    </Button>
  );
}
