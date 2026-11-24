"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveProcessScheduleAction } from "@/lib/actions/scheduling.actions";
import { ListScroll } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ProcessStatus } from "@/lib/constants/production";
import type { ProcessDefinition } from "@/lib/types/production";
import type { ProductGroupDefinition } from "@/lib/types/product-group";
import type { MpReceiptState } from "@/lib/types/mp-receipt";
import type { ProcessScheduleQueue, SchedulingOrderRow } from "@/lib/types/scheduling";
import { formatDate } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { MP_RECEIPT_STATE_LABELS, mpReceiptClass } from "@/lib/utils/mp-receipt";
import {
  computeScheduleRows,
  computeProductionChainSchedule,
  formatLoadDays,
  moveSchedulingRow,
} from "@/lib/utils/scheduling";

interface ProcessSchedulingProps {
  processes: ProcessDefinition[];
  groups: ProductGroupDefinition[];
  processId: string | null;
  familyGroupId: number | null;
  initialAnchorDate: string;
  initialRows: SchedulingOrderRow[];
  scheduleQueues: ProcessScheduleQueue[];
  canEdit: boolean;
}

export function ProcessScheduling({
  processes,
  groups,
  processId,
  familyGroupId,
  initialAnchorDate,
  initialRows,
  scheduleQueues,
  canEdit,
}: ProcessSchedulingProps) {
  const router = useRouter();
  const [anchorDate, setAnchorDate] = useState(initialAnchorDate);
  const [rows, setRows] = useState(initialRows);
  const [saving, setSaving] = useState(false);

  const chainSchedule = useMemo(
    () =>
      computeProductionChainSchedule(
        scheduleQueues,
        processes,
        rows.map((row) => row.orderId),
        processId ? { processId, anchorDate } : null,
      ),
    [scheduleQueues, processes, rows, processId, anchorDate],
  );

  const scheduledRows = useMemo(() => {
    if (!processId) {
      return rows.map((row) => ({
        ...row,
        loadDays: null,
        startDate: null,
        endDate: null,
        issue: null,
      }));
    }

    const processCode = processes.find((process) => process.id === processId)?.code;

    return rows.map((row) => {
      const calculated = processCode
        ? chainSchedule.windowsByOrder[row.orderId]?.[processCode]
        : undefined;
      return calculated
        ? { ...row, ...calculated }
        : computeScheduleRows([row], anchorDate)[0];
    });
  }, [rows, anchorDate, processId, processes, chainSchedule]);

  const totals = useMemo(() => {
    return scheduledRows.reduce(
      (acc, row) => ({
        weight: acc.weight + (row.weightKg ?? 0),
        days: acc.days + (row.loadDays ?? 0),
      }),
      { weight: 0, days: 0 },
    );
  }, [scheduledRows]);

  const expeditionDates = chainSchedule.expeditionByOrder;

  const goTo = (nextProcessId: string | null, nextFamilyId: number | null) => {
    const params = new URLSearchParams();
    if (nextProcessId) params.set("processo", nextProcessId);
    if (nextFamilyId !== null) params.set("familia", String(nextFamilyId));
    router.push(`/sequenciamento?${params.toString()}`);
  };

  const moveTo = (orderId: string, position: number) => {
    setRows((current) => moveSchedulingRow(current, orderId, position));
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveProcessScheduleAction({
        processId,
        anchorDate: processId ? anchorDate : null,
        rows: rows.map((row) => ({ orderId: row.orderId, notes: row.notes })),
      });
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else toast.error(result.message);
    } finally {
      setSaving(false);
    }
  };

  const groupLabel = (group: ProductGroupDefinition) =>
    `${group.groupType} — ${group.familyDescription}`;

  return (
    <section className="flex min-h-0 flex-col gap-3 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-end gap-3 rounded border bg-card p-3">
        <div className="space-y-1.5">
          <Label htmlFor="sequenciamento-processo">Processo</Label>
          <Select
            value={processId ?? "ALL"}
            onValueChange={(value) => goTo(value === "ALL" ? null : value, familyGroupId)}
            disabled={saving}
          >
            <SelectTrigger id="sequenciamento-processo" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os processos</SelectItem>
              {processes.map((process) => (
                <SelectItem key={process.id} value={process.id}>
                  {process.name} ({process.code})
                  {process.location ? ` — ${process.location}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sequenciamento-familia">Família</Label>
          <Select
            value={familyGroupId === null ? "ALL" : String(familyGroupId)}
            onValueChange={(value) => goTo(processId, value === "ALL" ? null : Number(value))}
            disabled={saving}
          >
            <SelectTrigger id="sequenciamento-familia" className="w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as famílias</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={String(group.id)}>
                  {groupLabel(group)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {processId ? (
          <div className="space-y-1.5">
            <Label htmlFor="sequenciamento-inicio">Data de início</Label>
            <Input
              id="sequenciamento-inicio"
              type="date"
              className="w-[170px]"
              value={anchorDate}
              onChange={(event) => setAnchorDate(event.target.value)}
              disabled={saving}
            />
          </div>
        ) : null}

        {canEdit ? (
          <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Salvar sequência
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{rows.length}</strong> OF(s)
        </span>
        <span>
          Peso: <strong className="text-foreground">{formatWeight(totals.weight)} kg</strong>
        </span>
        {processId ? (
          <>
            <span>
              Carga: <strong className="text-foreground">{formatLoadDays(totals.days)} dia(s)</strong>
            </span>
            <span>
              Início: <strong className="text-foreground">{formatDate(anchorDate)}</strong>
            </span>
          </>
        ) : null}
      </div>

      {canEdit ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          Ao salvar, as OFs exibidas assumem o início da sequência global. OFs já sequenciadas que
          ficaram fora dos filtros vão para o fim da fila. OFs com a expedição concluída não entram
          na fila e ficam no fim da Gestão de OF.
        </p>
      ) : null}

      {!processId ? (
        <p className="shrink-0 rounded border border-blue-500/30 bg-blue-50 px-3 py-2 text-xs text-blue-950 dark:bg-blue-950/20 dark:text-blue-100">
          Sem processo selecionado, a previsão considera as etapas aplicáveis de cada OF em
          sequência, a capacidade de cada processo e seu lead time cadastrado. OFs com dados de
          peso, família ou capacidade incompletos ficam sem previsão.
        </p>
      ) : null}

      {processId ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          A previsão de expedição considera toda a cadeia. A data selecionada é o início mínimo
          deste processo; etapas anteriores podem adiá-lo.
        </p>
      ) : null}

      {scheduledRows.length === 0 ? (
        <ListScroll>
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {processId
              ? "Nenhuma OF com este processo aplicável. Ajuste o filtro de família ou confira as etapas cadastradas nas OFs."
              : "Nenhuma OF ativa para exibir."}
          </p>
        </ListScroll>
      ) : (
        <ListScroll>
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              {processId
                ? "Sequenciamento global das OFs aplicáveis ao processo selecionado"
                : "Sequência global das OFs"}
            </caption>
            <thead className="sticky top-0 z-20">
              <tr className="bg-muted text-left text-xs uppercase tracking-wide">
                <th scope="col" className="min-w-20 border-b px-2 py-2">Seq.</th>
                <th scope="col" className="min-w-28 border-b px-2 py-2">OF</th>
                <th scope="col" className="min-w-40 border-b px-2 py-2">Cliente</th>
                <th scope="col" className="min-w-16 border-b px-2 py-2 text-right">Qtd.</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2 text-right">Peso (kg)</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Entrega</th>
                <th scope="col" className="min-w-28 border-b px-2 py-2">Data de expedição</th>
                <th scope="col" className="min-w-28 border-b px-2 py-2">Família</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Processo</th>
                <th scope="col" className="min-w-20 border-b px-2 py-2">MP</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2 text-right">Cap. (kg/dia)</th>
                <th scope="col" className="min-w-20 border-b px-2 py-2 text-right">Carga (dias)</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Início prev.</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Fim prev.</th>
              </tr>
            </thead>
            <tbody>
              {scheduledRows.map((row, index) => (
                <tr key={row.orderId} className="align-middle hover:bg-muted/20">
                  <td className="border-b px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      {canEdit ? (
                        <SequencePositionInput
                          key={`${row.orderId}-${index + 1}`}
                          orderCode={row.orderCode}
                          position={index + 1}
                          max={scheduledRows.length}
                          disabled={saving}
                          onCommit={(position) => moveTo(row.orderId, position)}
                        />
                      ) : (
                        <span
                          className="block w-full text-center font-semibold tabular-nums"
                          title={`Sequência global de ${row.orderCode}`}
                        >
                          {row.sequence ?? "—"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="border-b px-2 py-1.5 font-medium tabular-nums">{row.orderCode}</td>
                  <td className="border-b px-2 py-1.5">{row.customerName || "—"}</td>
                  <td className="border-b px-2 py-1.5 text-right tabular-nums">
                    {formatQuantity(row.quantity)}
                  </td>
                  <td
                    className="border-b px-2 py-1.5 text-right tabular-nums"
                    title={
                      row.processStatus === "CONCLUIDO"
                        ? "Processo concluído; peso considerado zero nesta fila."
                        : undefined
                    }
                  >
                    {formatWeight(row.weightKg)}
                  </td>
                  <td className="border-b px-2 py-1.5 tabular-nums">{formatDate(row.deliveryDate)}</td>
                  <td className="border-b px-2 py-1.5 tabular-nums">
                    {formatDate(expeditionDates[row.orderId] ?? null)}
                  </td>
                  <td className="border-b px-2 py-1.5">
                    {row.groupType ? (
                      <span title={row.familyDescription ?? undefined}>{row.groupType}</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">Sem família</span>
                    )}
                  </td>
                  <td className="border-b px-2 py-1.5">
                    {row.processStatus ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold",
                          processStatusClass(row.processStatus),
                        )}
                        title={`Processo selecionado — ${row.orderCode}: ${PROCESS_STATUS_UI_LABELS[row.processStatus]}`}
                      >
                        {PROCESS_STATUS_UI_LABELS[row.processStatus]}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="border-b px-2 py-1.5">
                    {row.mpState ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold",
                          mpReceiptClass(row.mpState),
                        )}
                        title={`Matéria-prima — ${row.orderCode}: ${MP_RECEIPT_STATE_LABELS[row.mpState]}`}
                      >
                        {MP_STATE_UI_LABELS[row.mpState]}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="border-b px-2 py-1.5 text-right tabular-nums">
                    {row.capacityKg === null ? "—" : formatWeight(row.capacityKg)}
                  </td>
                  <td className="border-b px-2 py-1.5 text-right tabular-nums">
                    {row.issue ? (
                      <span
                        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                        title={row.issue}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        —
                      </span>
                    ) : (
                      formatLoadDays(row.loadDays)
                    )}
                  </td>
                  <td className="border-b px-2 py-1.5 tabular-nums">{formatDate(row.startDate)}</td>
                  <td className="border-b px-2 py-1.5 tabular-nums">{formatDate(row.endDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListScroll>
      )}

      {processId && scheduledRows.some((row) => row.issue) ? (
        <p className="shrink-0 rounded border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          As OFs com alerta não entram no cálculo de datas. Confira a família/capacidade em{" "}
          <strong>Grupos de produtos</strong> e o peso dos itens.
        </p>
      ) : null}
    </section>
  );
}

/** Rótulos curtos da coluna Processo (078). */
const PROCESS_STATUS_UI_LABELS: Record<ProcessStatus, string> = {
  CONCLUIDO: "Concluído",
  NAO_INICIADO: "Pendente",
  NAO_APLICAVEL: "—",
};

/** Rótulos curtos da coluna MP (078) — mesma situação da coluna MP das listas. */
const MP_STATE_UI_LABELS: Record<MpReceiptState, string> = {
  NONE: "Pendente",
  PARCIAL: "Parcial",
  TOTAL: "Total",
};

/** Cores da coluna Processo — mesmas da célula de processo das listas. */
function processStatusClass(status: ProcessStatus): string {
  return status === "CONCLUIDO"
    ? "border-status-done/40 bg-status-done-bg text-status-done"
    : "border-border bg-background text-muted-foreground";
}

function SequencePositionInput({
  orderCode,
  position,
  max,
  disabled,
  onCommit,
}: {
  orderCode: string;
  position: number;
  max: number;
  disabled: boolean;
  onCommit: (position: number) => void;
}) {
  const [draft, setDraft] = useState(String(position));
  const skipNextBlur = useRef(false);

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      toast.error(`Informe uma sequência entre 1 e ${max}.`);
      setDraft(String(position));
      return;
    }

    setDraft(String(parsed));
    if (parsed !== position) onCommit(parsed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      skipNextBlur.current = true;
      setDraft(String(position));
      event.currentTarget.blur();
    }
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      className="h-7 w-14 px-1 text-center text-xs font-semibold tabular-nums"
      value={draft}
      maxLength={String(max).length}
      disabled={disabled}
      aria-label={`Posição na sequência da OF ${orderCode}`}
      title={`Informe uma posição de 1 a ${max}; as outras OFs serão deslocadas`}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (skipNextBlur.current) {
          skipNextBlur.current = false;
          return;
        }
        commit();
      }}
    />
  );
}
