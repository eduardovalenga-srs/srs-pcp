"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { updateProcessBatchAction } from "@/lib/actions/production.actions";
import {
  PROCESS_STATUS_LABELS,
  PROCESS_STATUS_SYMBOLS,
  type ProcessStatus,
} from "@/lib/constants/production";
import type { OrderProcessCell } from "@/lib/types/production";
import { formatQuantity } from "@/lib/utils/formatting";
import { allowedProcessStatuses } from "@/lib/utils/production";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

/** Seleção de uma célula agregada — a edição EM LOTE de um processo na OF. */
export interface ProcessBatchSelection {
  orderId: string;
  orderCode: string;
  processName: string;
  processCode: string;
  /** Célula agregada atual (pior situação + contador "feito/aplicável"). */
  cell: OrderProcessCell;
}

interface ProcessBatchEditorProps {
  selection: ProcessBatchSelection | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Folha lateral da edição EM LOTE (025): muda a situação de um processo em
 * TODOS os itens aplicáveis da OF de uma vez. Quantidades e observações por
 * item não mudam aqui — seguem na Fábrica 2 e no detalhe do pedido; cada
 * item atingido gera seu registro no histórico.
 */
export function ProcessBatchEditor({ selection, onOpenChange }: ProcessBatchEditorProps) {
  return (
    <Sheet open={!!selection} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {selection ? (
          <BatchForm
            key={`${selection.orderId}:${selection.processCode}`}
            selection={selection}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function BatchForm({ selection, onClose }: { selection: ProcessBatchSelection; onClose: () => void }) {
  const router = useRouter();
  const { cell } = selection;

  // "Não aplicável" NUNCA é opção de lote: a célula "—" (0 itens
  // aplicáveis) nem abre esta folha, e o lote não desmarca um processo
  // que o pedido definiu como fora.
  const allowed: readonly ProcessStatus[] = allowedProcessStatuses(
    selection.processCode,
  ).filter((value) => value !== "NAO_APLICAVEL");
  const statusChoices: readonly ProcessStatus[] = allowed.includes(cell.status)
    ? allowed
    : [cell.status, ...allowed];

  const [status, setStatus] = useState<ProcessStatus>(cell.status);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await updateProcessBatchAction({
        orderId: selection.orderId,
        processCode: selection.processCode,
        status,
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

  const quantities =
    cell.quantityPlanned !== null || cell.quantityCompleted !== null
      ? `${formatQuantity(cell.quantityCompleted ?? 0)}/${formatQuantity(cell.quantityPlanned ?? 0)}`
      : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{selection.processName}</SheetTitle>
        <SheetDescription>
          {selection.orderCode} — situação aplicada a toda a OF.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4 pb-4">
        <section
          aria-label="Situação agregada da OF"
          className="rounded border bg-muted/40 px-3 py-2 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Situação agregada
            </span>
            <span className="tabular-nums">
              {cell.done}/{cell.applicable} concluído{cell.applicable === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {cell.applicable} {cell.applicable === 1 ? "item tem" : "itens têm"} este processo aplicável
            nesta OF{quantities ? ` · quantidades somadas: ${quantities}` : ""}. A edição por item
            (quantidades e observações) continua na Fábrica 2 e no detalhe do pedido.
          </p>
        </section>

        <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="lote-status">Nova situação</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as ProcessStatus)}>
              <SelectTrigger id="lote-status" className="w-full">
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
              Será aplicada a todos os {cell.applicable}{" "}
              {cell.applicable === 1 ? "item aplicável" : "itens aplicáveis"} desta OF — cada alteração
              gera seu registro no histórico.
            </p>
          </div>
        </fieldset>

        <SheetFooter className="px-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={onSave} disabled={saving || status === cell.status}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Aplicar à OF
          </Button>
        </SheetFooter>
      </div>
    </>
  );
}
