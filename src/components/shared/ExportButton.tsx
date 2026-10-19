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
export function ExportButton({ endpoint, fallbackFileName }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}${window.location.search}`, { method: "GET" });
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
    <Button type="button" variant="outline" size="sm" onClick={() => void handleExport()} disabled={busy}>
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
      {busy ? "Exportando…" : "Exportar Excel"}
    </Button>
  );
}
