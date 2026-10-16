"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { getImportBatchErrorsAction, getImportHistoryAction } from "@/lib/actions/import.actions";
import type { ImportBatchHistory, ImportErrorEntry } from "@/lib/types/import";
import { formatDateTime } from "@/lib/utils/dates";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { formatFileSize } from "@/components/importacao/format";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  PROCESSANDO: "Processando",
  CONCLUIDO: "Concluída",
  COM_ERROS: "Com erros",
  FALHOU: "Falhou",
};

const STATUS_VARIANTS: Record<string, BadgeProps["variant"]> = {
  PENDENTE: "secondary",
  PROCESSANDO: "muted",
  CONCLUIDO: "success",
  COM_ERROS: "warning",
  FALHOU: "destructive",
};

const COLUMN_COUNT = 8;

interface ImportHistoryProps {
  initialBatches: ImportBatchHistory[];
  initialError: string | null;
}

/** Tabela de lotes importados, com detalhe expansível dos erros por lote. */
export function ImportHistory({ initialBatches, initialError }: ImportHistoryProps) {
  const [batches, setBatches] = useState<ImportBatchHistory[]>(initialBatches);
  const [error, setError] = useState<string | null>(initialError);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorsByBatch, setErrorsByBatch] = useState<Record<string, ImportErrorEntry[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      try {
        const data = await getImportHistoryAction();
        if (Array.isArray(data)) {
          setBatches(data);
          setError(null);
          setExpandedId(null);
          setErrorsByBatch({});
          setDetailError(null);
          toast.success("Histórico atualizado.");
        } else {
          setError(data.error);
          toast.error(data.error);
        }
      } catch {
        const message = "Não foi possível carregar o histórico de importações.";
        setError(message);
        toast.error(message);
      }
    });
  };

  const toggleErrors = async (batch: ImportBatchHistory) => {
    if (expandedId === batch.id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(batch.id);
    setDetailError(null);

    if (errorsByBatch[batch.id]) return;

    setLoadingId(batch.id);
    try {
      const data = await getImportBatchErrorsAction(batch.id);
      if (Array.isArray(data)) {
        setErrorsByBatch((previous) => ({ ...previous, [batch.id]: data }));
      } else {
        setDetailError(data.error);
        toast.error(data.error);
      }
    } catch {
      const message = "Não foi possível carregar os erros da importação.";
      setDetailError(message);
      toast.error(message);
    } finally {
      setLoadingId(null);
    }
  };

  if (error) {
    return (
      <ErrorState
        title="Não foi possível carregar o histórico"
        message={error}
        onRetry={refresh}
      />
    );
  }

  if (batches.length === 0) {
    return (
      <EmptyState
        title="Nenhuma importação registrada"
        description="Os arquivos importados (planilha ou PDF) aparecem aqui com o resumo de OFs e os erros de cada lote."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {batches.length} lote(s) de importação — mais recentes primeiro.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} aria-hidden />
          {isRefreshing ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>

      <div className="overflow-auto rounded border bg-card">
        <Table aria-label="Histórico de importações">
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>OFs</TableHead>
              <TableHead>Gravadas</TableHead>
              <TableHead>Alertas</TableHead>
              <TableHead>Erros</TableHead>
              <TableHead>
                <span className="sr-only">Detalhes</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((batch) => {
              const hasErrors = (batch.errorRows ?? 0) > 0;
              const expanded = expandedId === batch.id;

              return (
                <TableRowsWithDetail
                  key={batch.id}
                  batch={batch}
                  expanded={expanded}
                  hasErrors={hasErrors}
                  loading={loadingId === batch.id}
                  detailError={detailError}
                  errors={errorsByBatch[batch.id]}
                  onToggle={() => void toggleErrors(batch)}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface RowWithDetailProps {
  batch: ImportBatchHistory;
  expanded: boolean;
  hasErrors: boolean;
  loading: boolean;
  detailError: string | null;
  errors: ImportErrorEntry[] | undefined;
  onToggle: () => void;
}

function TableRowsWithDetail({ batch, expanded, hasErrors, loading, detailError, errors, onToggle }: RowWithDetailProps) {
  const detailId = `erros-lote-${batch.id}`;

  return (
    <>
      <TableRow>
        <TableCell className="max-w-[280px]">
          <span className="block truncate font-medium" title={batch.fileName}>
            {batch.fileName}
          </span>
          <span className="block text-xs text-muted-foreground">
            {formatFileSize(batch.fileSize)}
            {batch.createdByName ? ` · por ${batch.createdByName}` : ""}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(batch.createdAt)}</TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANTS[batch.status] ?? "outline"}>
            {STATUS_LABELS[batch.status] ?? batch.status}
          </Badge>
        </TableCell>
        <TableCell className="tabular-nums">{batch.totalRows ?? 0}</TableCell>
        <TableCell className="tabular-nums">{batch.validRows ?? 0}</TableCell>
        <TableCell className="tabular-nums">{batch.warningRows ?? 0}</TableCell>
        <TableCell className="tabular-nums">{batch.errorRows ?? 0}</TableCell>
        <TableCell>
          {hasErrors ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={onToggle}
            >
              {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              Ver erros
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow className="hover:bg-muted/30">
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/20">
            <div id={detailId} className="space-y-2 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Erros do lote {batch.fileName}
              </p>

              {loading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-2/3" />
                </div>
              ) : detailError ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {detailError}
                </p>
              ) : !errors || errors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum erro registrado para este lote.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {errors.map((entry, index) => (
                    <li key={`${batch.id}-${index}`}>
                      <span className="font-medium">Linha {entry.rowNumber}</span>
                      {entry.columnName ? ` · ${entry.columnName}` : ""} — {entry.message}
                      {entry.rawValue ? (
                        <span className="text-muted-foreground"> (valor: &quot;{entry.rawValue}&quot;)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
