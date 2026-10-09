"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, X } from "lucide-react";

import { ALLOWED_IMPORT_EXTENSIONS, DEFAULT_MAX_FILE_SIZE_BYTES } from "@/lib/constants/import";
import { formatFileSize } from "@/components/importacao/format";
import { Button } from "@/components/ui/button";

interface FileDropProps {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

/** Validação de conveniência no cliente — o servidor revalida sempre. */
function validateFile(next: File): string | null {
  const dotIndex = next.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? next.name.toLowerCase().slice(dotIndex) : "";

  if (!(ALLOWED_IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
    return "Formato não suportado. Selecione um arquivo .xlsx ou .xls.";
  }
  if (next.size === 0) {
    return "O arquivo está vazio. Escolha outro arquivo.";
  }
  if (next.size > DEFAULT_MAX_FILE_SIZE_BYTES) {
    return `Arquivo muito grande (${formatFileSize(next.size)}). O limite é de ${formatFileSize(DEFAULT_MAX_FILE_SIZE_BYTES)}.`;
  }
  return null;
}

/**
 * Seleção de arquivo acessível: <input type="file"> real (operável por teclado
 * e leitor de tela) dentro de uma área de arrastar-e-soltar.
 */
export function FileDrop({ file, onChange, disabled = false }: FileDropProps) {
  const [error, setError] = useState<string | null>(null);
  const inputId = "importacao-arquivo";

  const accept = (next: File | null) => {
    if (!next) {
      setError(null);
      onChange(null);
      return;
    }

    const validation = validateFile(next);
    if (validation) {
      // Mantém o arquivo anterior e só sinaliza o problema.
      setError(validation);
      return;
    }

    setError(null);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-sm font-medium">
          Arquivo da planilha
        </label>

        <input
          id={inputId}
          type="file"
          accept=".xlsx,.xls"
          className="peer sr-only"
          disabled={disabled}
          aria-describedby={`${inputId}-ajuda`}
          onChange={(event) => accept(event.target.files?.[0] ?? null)}
        />

        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            if (!disabled) event.preventDefault();
          }}
          onDrop={(event) => {
            if (disabled) return;
            event.preventDefault();
            accept(event.dataTransfer.files?.[0] ?? null);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed bg-muted/20 px-4 py-8 text-center transition-colors hover:bg-muted/40 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:outline-none"
        >
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">
            {file ? "Trocar arquivo" : "Arraste o arquivo aqui ou clique para selecionar"}
          </span>
          <span className="text-xs text-muted-foreground">
            Formatos aceitos: .xlsx e .xls · até {formatFileSize(DEFAULT_MAX_FILE_SIZE_BYTES)}
          </span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {file ? (
        <div className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">({formatFileSize(file.size)})</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            <X aria-hidden />
            Remover
          </Button>
        </div>
      ) : null}

      <div id={`${inputId}-ajuda`} className="space-y-1 text-xs text-muted-foreground">
        <p>
          <a
            href="/api/importacao/modelo"
            download
            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:text-primary/80"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Baixar modelo de planilha (.xlsx)
          </a>{" "}
          — o modelo já contém a aba <strong>INSTRUÇÕES</strong> com os formatos de data, decimais, status de
          processo e a regra de duplicidade.
        </p>
        <p>Limite de 20.000 linhas. Macros e fórmulas nunca são executadas.</p>
      </div>
    </div>
  );
}
