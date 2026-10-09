"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Save, CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { getItemHistoryAction, updateProcessAction } from "@/lib/actions/production.actions";
import { updateItemDeliveryDateAction } from "@/lib/actions/orders.actions";
import {
  PROCESS_STATUS_LABELS,
  PROCESS_STATUS_SYMBOLS,
  type ProcessStatus,
} from "@/lib/constants/production";
import type { ProcessDefinition, ProductionEvent } from "@/lib/types/production";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatQuantity } from "@/lib/utils/formatting";
import { allowedProcessStatuses } from "@/lib/utils/production";
import { getProcessWindow } from "@/lib/utils/process-schedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ProcessStatusBadge } from "@/components/shared/StatusBadges";

export interface ProcessSelection {
  productionProcessId: string;
  orderItemId: string;
  orderCode: string;
  itemDescription: string;
  processName: string;
  processCode: string;
  deliveryDate: string | null;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
}

export interface ProductionCapabilities {
  canUpdateStatus: boolean;
  canEditQuantities: boolean;
  canViewHistory: boolean;
  /** Edição manual da data de entrega (orders.edit) — recalcula as previsões. */
  canEditDelivery: boolean;
}

interface ProcessDetailsSheetProps {
  selection: ProcessSelection | null;
  /** Catálogo (com durações) para calcular as datas previstas. */
  processes: ProcessDefinition[];
  onOpenChange: (open: boolean) => void;
  capabilities: ProductionCapabilities;
}

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; events: ProductionEvent[] }
  | { status: "error"; message: string };

/**
 * Folha lateral com a edição completa de um processo + histórico.
 * O formulário é remontado (key) a cada processo selecionado, então o estado
 * local nasce a partir das props — sem efeitos de sincronização.
 */
export function ProcessDetailsSheet({ selection, processes, onOpenChange, capabilities }: ProcessDetailsSheetProps) {
  return (
    <Sheet open={!!selection} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        {selection ? (
          <ProcessForm
            key={selection.productionProcessId}
            selection={selection}
            processes={processes}
            capabilities={capabilities}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ProcessForm({
  selection,
  processes,
  capabilities,
  onClose,
}: {
  selection: ProcessSelection;
  processes: ProcessDefinition[];
  capabilities: ProductionCapabilities;
  onClose: () => void;
}) {
  const router = useRouter();

  // Datas prévias deste processo: janela contada de trás para frente da entrega.
  const catalogEntry = processes.find((item) => item.code === selection.processCode);
  const duration = catalogEntry?.durationDays ?? 1;

  // Entrega editável na própria folha: a prévia usa o estado local (a
  // janela recalcula ao digitar) e a gravação persiste o campo — depois
  // disso o refresh recalcula as previsões de todos os processos. O valor
  // gravado fica em estado próprio porque a seleção (props) não muda com
  // a folha aberta.
  const [deliveryDate, setDeliveryDate] = useState(selection.deliveryDate);
  const [savedDeliveryDate, setSavedDeliveryDate] = useState(selection.deliveryDate);
  const [savingDelivery, setSavingDelivery] = useState(false);

  const plannedWindow = getProcessWindow(deliveryDate, processes, selection.processCode);
  const deliveryDirty = deliveryDate !== savedDeliveryDate;

  const [status, setStatus] = useState<ProcessStatus>(selection.status);

  // Situações escolhíveis deste processo: a maioria tem o catálogo
  // inteiro; processos restritos (MP) mostram só as duas posições.
  // A situação atual fica sempre visível para poder trocar — ex.:
  // MP desmarcado no pedido (NAO_APLICAVEL) volta a ser editável,
  // mas essa opção não é mais oferecida.
  const allowedStatuses = allowedProcessStatuses(selection.processCode);
  const statusChoices: readonly ProcessStatus[] = allowedStatuses.includes(status)
    ? allowedStatuses
    : [status, ...allowedStatuses];
  const [quantityPlanned, setQuantityPlanned] = useState(
    selection.quantityPlanned === null ? "" : String(selection.quantityPlanned),
  );
  const [quantityCompleted, setQuantityCompleted] = useState(
    selection.quantityCompleted === null ? "" : String(selection.quantityCompleted),
  );
  const [notes, setNotes] = useState(selection.notes ?? "");
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<HistoryState>(() =>
    capabilities.canViewHistory ? { status: "loading" } : { status: "error", message: "" },
  );

  useEffect(() => {
    if (!capabilities.canViewHistory) return;
    let cancelled = false;

    getItemHistoryAction(selection.orderItemId)
      .then((result) => {
        if (cancelled) return;
        setHistory(
          result.success
            ? { status: "ready", events: result.events }
            : { status: "error", message: result.message },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setHistory({ status: "error", message: "Não foi possível carregar o histórico." });
      });

    return () => {
      cancelled = true;
    };
  }, [selection.orderItemId, capabilities.canViewHistory]);

  const readOnly = !capabilities.canUpdateStatus;
  const dirty =
    status !== selection.status ||
    quantityPlanned !== (selection.quantityPlanned === null ? "" : String(selection.quantityPlanned)) ||
    quantityCompleted !== (selection.quantityCompleted === null ? "" : String(selection.quantityCompleted)) ||
    notes !== (selection.notes ?? "");

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await updateProcessAction({
        productionProcessId: selection.productionProcessId,
        status,
        quantityPlanned,
        quantityCompleted,
        notes,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (!result.changed) {
        toast.info(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const onSaveDelivery = async () => {
    setSavingDelivery(true);
    try {
      const result = await updateItemDeliveryDateAction(selection.orderItemId, deliveryDate);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setSavedDeliveryDate(result.deliveryDate);
      toast.success(result.message);
      router.refresh();
    } finally {
      setSavingDelivery(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{selection.processName}</SheetTitle>
        <SheetDescription>
          {selection.orderCode} — {selection.itemDescription}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4 pb-4">
        <section aria-label="Previsão de execução" className="rounded border bg-muted/40 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Previsão de execução
            </span>
            <span className="text-xs text-muted-foreground">
              Entrega:{" "}
              <span className="tabular-nums">
                {deliveryDate ? formatDate(deliveryDate) : "—"}
              </span>
            </span>
          </div>
          <p className="mt-1">
            {plannedWindow ? (
              <>
                De <span className="font-medium tabular-nums">{formatDate(plannedWindow.start)}</span> a{" "}
                <span className="font-medium tabular-nums">{formatDate(plannedWindow.end)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  ({duration} {duration === 1 ? "dia útil" : "dias úteis"})
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Sem data de entrega — não há como calcular as datas.
              </span>
            )}
          </p>
          {catalogEntry?.location ? (
            <p className="mt-0.5 text-xs text-muted-foreground">Local: {catalogEntry.location}</p>
          ) : null}
          {capabilities.canEditDelivery ? (
            <>
              <div className="mt-2 flex items-end gap-2 border-t pt-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="processo-entrega" className="text-xs">
                    Entrega (edição manual)
                  </Label>
                  <Input
                    id="processo-entrega"
                    type="date"
                    className="h-8"
                    value={deliveryDate ?? ""}
                    onChange={(event) => setDeliveryDate(event.target.value || null)}
                    disabled={savingDelivery}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSaveDelivery}
                  disabled={!deliveryDirty || savingDelivery}
                >
                  {savingDelivery ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <CalendarDays className="h-4 w-4" aria-hidden />
                  )}
                  Salvar entrega
                </Button>
              </div>
              {deliveryDirty ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  A prévia acima já usa a nova data — salve para aplicar a todos os processos.
                </p>
              ) : null}
            </>
          ) : null}
        </section>

        <fieldset disabled={readOnly || saving} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="processo-status">Situação</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as ProcessStatus)}>
              <SelectTrigger id="processo-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusChoices.map((value) => (
                  <SelectItem key={value} value={value}>
                    <span aria-hidden>{PROCESS_STATUS_SYMBOLS[value]}</span>
                    {PROCESS_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O avanço entre etapas é sempre manual — nada é concluído automaticamente.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="processo-planejado">Qtd. planejada</Label>
              <Input
                id="processo-planejado"
                inputMode="decimal"
                value={quantityPlanned}
                onChange={(event) => setQuantityPlanned(event.target.value)}
                placeholder="0"
                disabled={!capabilities.canEditQuantities}
                aria-describedby="processo-quantidade-ajuda"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="processo-produzida">Qtd. produzida</Label>
              <Input
                id="processo-produzida"
                inputMode="decimal"
                value={quantityCompleted}
                onChange={(event) => setQuantityCompleted(event.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <p id="processo-quantidade-ajuda" className="text-xs text-muted-foreground">
            Aceita vírgula decimal.{" "}
            {!capabilities.canEditQuantities
              ? "A quantidade planejada só pode ser alterada por perfis com permissão de edição."
              : ""}
          </p>

          <div className="space-y-1">
            <Label htmlFor="processo-observacoes">Observações</Label>
            <Textarea
              id="processo-observacoes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Observações do operador, impedimentos, materiais…"
            />
          </div>
        </fieldset>

        <SheetFooter className="px-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={onSave} disabled={readOnly || saving || !dirty}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Salvar alterações
          </Button>
        </SheetFooter>

        <Separator />

        <section aria-label="Histórico do item" className="space-y-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-semibold">Histórico do item</h3>
          </div>

          {!capabilities.canViewHistory ? (
            <p className="text-sm text-muted-foreground">Seu perfil não visualiza o histórico.</p>
          ) : history.status === "loading" ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : history.status === "error" ? (
            <p role="alert" className="text-sm text-status-blocked">
              {history.message || "Não foi possível carregar o histórico."}
            </p>
          ) : history.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>
          ) : (
            <ul className="space-y-2">
              {history.events.map((event) => (
                <li key={event.id} className="rounded border bg-muted/30 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                      {event.userName ? ` · ${event.userName}` : ""}
                      {event.processCode ? ` · ${event.processCode}` : ""}
                    </span>
                    <Badge variant={event.event_type === "STATUS_CHANGE" ? "secondary" : "outline"}>
                      {event.event_type === "STATUS_CHANGE" ? "Situação" : "Dados"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    {event.oldStatus ? <ProcessStatusBadge status={event.oldStatus} showLabel={false} /> : null}
                    {event.oldStatus && event.newStatus ? <span aria-hidden>→</span> : null}
                    {event.newStatus ? <ProcessStatusBadge status={event.newStatus} /> : null}
                    {event.oldQuantity !== null || event.newQuantity !== null ? (
                      <span className="text-muted-foreground">
                        qtd. {formatQuantity(event.oldQuantity)} → {formatQuantity(event.newQuantity)}
                      </span>
                    ) : null}
                  </div>
                  {event.notes ? <p className="mt-1 text-xs text-muted-foreground">{event.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
