"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveProcessScheduleAction } from "@/lib/actions/scheduling.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProcessDefinition } from "@/lib/types/production";
import type { ProductGroupDefinition } from "@/lib/types/product-group";
import type { SchedulingOrderRow } from "@/lib/types/scheduling";
import { formatDate } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { computeScheduleRows, formatLoadDays } from "@/lib/utils/scheduling";

interface ProcessSchedulingProps {
  processes: ProcessDefinition[];
  groups: ProductGroupDefinition[];
  processId: string;
  familyGroupId: number | null;
  initialAnchorDate: string;
  initialRows: SchedulingOrderRow[];
  canEdit: boolean;
}

export function ProcessScheduling({
  processes,
  groups,
  processId,
  familyGroupId,
  initialAnchorDate,
  initialRows,
  canEdit,
}: ProcessSchedulingProps) {
  const router = useRouter();
  const [anchorDate, setAnchorDate] = useState(initialAnchorDate);
  const [rows, setRows] = useState(initialRows);
  const [saving, setSaving] = useState(false);

  const scheduledRows = useMemo(
    () => computeScheduleRows(rows, anchorDate),
    [rows, anchorDate],
  );

  const totals = useMemo(() => {
    return scheduledRows.reduce(
      (acc, row) => ({
        weight: acc.weight + (row.weightKg ?? 0),
        days: acc.days + (row.loadDays ?? 0),
      }),
      { weight: 0, days: 0 },
    );
  }, [scheduledRows]);

  const goTo = (nextProcessId: string, nextFamilyId: number | null) => {
    const params = new URLSearchParams();
    params.set("processo", nextProcessId);
    if (nextFamilyId !== null) params.set("familia", String(nextFamilyId));
    router.push(`/sequenciamento?${params.toString()}`);
  };

  const move = (index: number, direction: -1 | 1) => {
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });
  };

  const updateNotes = (orderId: string, notes: string) => {
    setRows((current) =>
      current.map((row) => (row.orderId === orderId ? { ...row, notes } : row)),
    );
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveProcessScheduleAction({
        processId,
        anchorDate,
        rows: rows.map((row) => ({ orderId: row.orderId, notes: row.notes })),
      });
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
    } finally {
      setSaving(false);
    }
  };

  const groupLabel = (group: ProductGroupDefinition) =>
    `${group.groupType} — ${group.familyDescription}`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded border bg-card p-3">
        <div className="space-y-1.5">
          <Label htmlFor="sequenciamento-processo">Processo *</Label>
          <Select
            value={processId}
            onValueChange={(value) => goTo(value, familyGroupId)}
            disabled={saving}
          >
            <SelectTrigger id="sequenciamento-processo" className="w-[260px]">
              <SelectValue placeholder="Selecione o processo" />
            </SelectTrigger>
            <SelectContent>
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
        <span>
          Carga: <strong className="text-foreground">{formatLoadDays(totals.days)} dia(s)</strong>
        </span>
        <span>
          Início: <strong className="text-foreground">{formatDate(anchorDate)}</strong>
        </span>
      </div>

      {scheduledRows.length === 0 ? (
        <p className="rounded border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma OF ativa para este processo. Ajuste o filtro de família ou importe as OFs com a família
          selecionada.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              Sequenciamento das OFs para o processo selecionado
            </caption>
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wide">
                <th scope="col" className="min-w-20 border-b px-2 py-2">Seq.</th>
                <th scope="col" className="min-w-28 border-b px-2 py-2">OF</th>
                <th scope="col" className="min-w-40 border-b px-2 py-2">Cliente</th>
                <th scope="col" className="min-w-16 border-b px-2 py-2 text-right">Qtd.</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2 text-right">Peso (kg)</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Entrega</th>
                <th scope="col" className="min-w-28 border-b px-2 py-2">Família</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2 text-right">Cap. (kg/dia)</th>
                <th scope="col" className="min-w-20 border-b px-2 py-2 text-right">Carga (dias)</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Início prev.</th>
                <th scope="col" className="min-w-24 border-b px-2 py-2">Fim prev.</th>
                <th scope="col" className="min-w-48 border-b px-2 py-2">Observação</th>
              </tr>
            </thead>
            <tbody>
              {scheduledRows.map((row, index) => (
                <tr key={row.orderId} className="align-middle hover:bg-muted/20">
                  <td className="border-b px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="w-6 text-right font-semibold tabular-nums">{index + 1}</span>
                      {canEdit ? (
                        <span className="flex flex-col">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-5 w-5"
                            onClick={() => move(index, -1)}
                            disabled={saving || index === 0}
                            aria-label={`Mover ${row.orderCode} para cima`}
                          >
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-5 w-5"
                            onClick={() => move(index, 1)}
                            disabled={saving || index === scheduledRows.length - 1}
                            aria-label={`Mover ${row.orderCode} para baixo`}
                          >
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="border-b px-2 py-1.5 font-medium tabular-nums">{row.orderCode}</td>
                  <td className="border-b px-2 py-1.5">{row.customerName || "—"}</td>
                  <td className="border-b px-2 py-1.5 text-right tabular-nums">
                    {formatQuantity(row.quantity)}
                  </td>
                  <td className="border-b px-2 py-1.5 text-right tabular-nums">
                    {formatWeight(row.weightKg)}
                  </td>
                  <td className="border-b px-2 py-1.5 tabular-nums">{formatDate(row.deliveryDate)}</td>
                  <td className="border-b px-2 py-1.5">
                    {row.groupType ? (
                      <span title={row.familyDescription ?? undefined}>{row.groupType}</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">Sem família</span>
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
                  <td className="border-b px-2 py-1.5">
                    {canEdit ? (
                      <Input
                        aria-label={`Observação da OF ${row.orderCode}`}
                        className="h-7 min-w-44 px-1.5 text-xs"
                        maxLength={500}
                        value={row.notes ?? ""}
                        disabled={saving}
                        onChange={(event) => updateNotes(row.orderId, event.target.value)}
                      />
                    ) : (
                      row.notes || "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scheduledRows.some((row) => row.issue) ? (
        <p className="rounded border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          As OFs com alerta não entram no cálculo de datas. Confira a família/capacidade em{" "}
          <strong>Grupos de produtos</strong> e o peso dos itens.
        </p>
      ) : null}
    </section>
  );
}
