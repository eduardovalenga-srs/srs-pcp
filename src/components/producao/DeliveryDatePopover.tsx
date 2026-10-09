"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { updateItemDeliveryDateAction } from "@/lib/actions/orders.actions";
import { isValidISODate } from "@/lib/utils/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DeliveryDatePopoverProps {
  orderItemId: string;
  /** Data atual (AAAA-MM-DD) ou null (sem entrega). */
  deliveryDate: string | null;
  /** Rótulo do item (OF — descrição) em aria-label e mensagens. */
  itemLabel: string;
  /** Conteúdo gatilho — a data formatada + alerta de atraso. */
  children: ReactNode;
}

/**
 * Edição manual da data de entrega de um item (ADMIN/GESTOR), na própria
 * coluna "Ent." da gestão de entregas. Gravada a nova data, o refresh da
 * página recalcula as previsões de todos os processos (janelas derivadas
 * da entrega) e a regra de atraso da linha.
 */
export function DeliveryDatePopover({
  orderItemId,
  deliveryDate,
  itemLabel,
  children,
}: DeliveryDatePopoverProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(deliveryDate ?? "");
  const [saving, setSaving] = useState(false);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Cada abertura parte da data vigente — descartar edições abandonadas.
    if (next) setDraft(deliveryDate ?? "");
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateItemDeliveryDateAction(orderItemId, draft);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  // Vazio é permitido = limpar a entrega (a linha fica sem previsão).
  const invalid = draft !== "" && !isValidISODate(draft);
  const unchanged = draft === (deliveryDate ?? "");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group -mx-1 flex w-full items-center gap-1 rounded px-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`Editar data de entrega de ${itemLabel}`}
          title="Editar data de entrega"
        >
          {children}
          <Pencil
            className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`entrega-${orderItemId}`}>Data de entrega</Label>
          <Input
            id={`entrega-${orderItemId}`}
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          As previsões de todos os processos são recalculadas a partir desta data.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving || invalid || unchanged}>
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
