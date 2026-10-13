"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateProcessAction } from "@/lib/actions/production.actions";
import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, type ProcessStatus } from "@/lib/constants/production";
import { MP_PROCESS_CODE } from "@/lib/constants/processes";
import type { ItemProcess } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import { formatDate } from "@/lib/utils/dates";
import { computeProcessSchedule } from "@/lib/utils/process-schedule";
import { ProcessStatusBadge } from "@/components/shared/StatusBadges";
import { ProcessDetailsSheet, type ProductionCapabilities } from "@/components/producao/ProcessDetailsSheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Processos de um item pai ou filho da OF, em linhas com:
 *
 *  - janela prevista de execução (dias úteis, contada de trás para frente
 *    a partir da entrega — sem alterar a regra da cadeia de processos);
 *  - seletor de status (mesma ação da tabela de produção, com histórico);
 *  - marcação de necessidade: desmarcado grava NAO_APLICAVEL e marcado
 *    volta para NAO_INICIADO (a data prevista continua aparecendo);
 *  - "Detalhes" abrindo a folha lateral completa (quantidades, notas e
 *    histórico).
 *
 * Sem lógica de negócio na tela: toda gravação passa pela server action.
 */
interface ItemProcessesProps {
  orderCode: string;
  orderItemId: string;
  itemDescription: string;
  /** Entrega efetiva (item ou pedido) — base da previsão. */
  deliveryDate: string | null;
  processes: ItemProcess[];
  catalog: ProcessDefinition[];
  capabilities: ProductionCapabilities;
}

export function ItemProcesses({
  orderCode,
  orderItemId,
  itemDescription,
  deliveryDate,
  processes,
  catalog,
  capabilities,
}: ItemProcessesProps) {
  const router = useRouter();
  const [rows, setRows] = useState<ItemProcess[]>(processes);
  // Sincroniza o estado quando as props do servidor mudam (router.refresh).
  const [syncedProcesses, setSyncedProcesses] = useState<ItemProcess[]>(processes);
  if (syncedProcesses !== processes) {
    setSyncedProcesses(processes);
    setRows(processes);
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ItemProcess | null>(null);

  const schedule = useMemo(
    () => computeProcessSchedule(deliveryDate, catalog),
    [deliveryDate, catalog],
  );

  const applyStatus = async (row: ItemProcess, next: ProcessStatus) => {
    if (row.status === next) return;

    const previous = rows;
    setRows((current) =>
      current.map((entry) => (entry.id === row.id ? { ...entry, status: next } : entry)),
    );
    setBusyId(row.id);

    try {
      // Envia os valores atuais para não apagar quantidades/notas.
      const result = await updateProcessAction({
        productionProcessId: row.id,
        status: next,
        quantityPlanned: row.quantityPlanned,
        quantityCompleted: row.quantityCompleted,
        notes: row.notes,
      });

      if (!result.success) {
        setRows(previous);
        toast.error(result.message);
        return;
      }
      if (result.changed) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.info(result.message);
      }
    } catch {
      setRows(previous);
      toast.error("Não foi possível atualizar o processo. Tente novamente.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleNecessity = async (row: ItemProcess, applies: boolean) => {
    await applyStatus(row, applies ? "NAO_INICIADO" : "NAO_APLICAVEL");
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nenhum processo vinculado a este item.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1">
        {rows.map((row) => {
          const window = schedule.get(row.code);
          const busy = busyId === row.id;
          const applies = row.status !== "NAO_APLICAVEL";
          // MP é pré-requisito da produção (021): o serviço rejeita
          // NAO_APLICAVEL para ele, então a marcação não é toggleável.
          const isMp = row.code === MP_PROCESS_CODE;
          const necessityTitle = isMp
            ? "MP é pré-requisito para iniciar a produção — sempre aplicável."
            : applies
              ? "Necessário neste item — desmarcar para marcar como não aplicável."
              : "Não se aplica a este item — marcar para voltar a não iniciado.";

          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border bg-muted/20 px-2 py-1.5"
            >
              <label
                className={`flex items-center gap-1.5 text-xs ${isMp ? "cursor-default" : "cursor-pointer"}`}
                title={necessityTitle}
              >
                <input
                  type="checkbox"
                  checked={applies}
                  disabled={busy || isMp || !capabilities.canUpdateStatus}
                  onChange={(event) => void toggleNecessity(row, event.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-label={`Necessário: ${row.name} em ${itemDescription}`}
                />
                <span aria-hidden>Nec.</span>
              </label>

              <span className="text-xs font-semibold tabular-nums">{row.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm" title={row.name}>
                {row.name}
              </span>

              <ProcessStatusBadge status={row.status} />

              {capabilities.canUpdateStatus ? (
                <Select
                  value={row.status}
                  onValueChange={(value) => void applyStatus(row, value as ProcessStatus)}
                  disabled={busy}
                >
                  <SelectTrigger
                    className="h-8 w-[190px] text-xs"
                    aria-label={`Status de ${row.name} em ${itemDescription}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROCESS_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {PROCESS_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <span
                className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
                title="Previsão calculada em dias úteis a partir da data de entrega."
              >
                <CalendarClock aria-hidden className="h-3.5 w-3.5" />
                {window ? `${formatDate(window.start)} – ${formatDate(window.end)}` : "—"}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => setSelection(row)}
              >
                {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
                Detalhes
              </Button>
            </li>
          );
        })}
      </ul>

      <ProcessDetailsSheet
        selection={
          selection
            ? {
                productionProcessId: selection.id,
                orderItemId,
                orderCode,
                itemDescription,
                processName: selection.name,
                processCode: selection.code,
                deliveryDate,
                status: rows.find((row) => row.id === selection.id)?.status ?? selection.status,
                quantityPlanned: selection.quantityPlanned,
                quantityCompleted: selection.quantityCompleted,
                notes: selection.notes,
              }
            : null
        }
        processes={catalog}
        capabilities={capabilities}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      />
    </div>
  );
}
