"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  cancelRomaneioAction,
  deleteRomaneioAction,
  saveRomaneioAction,
} from "@/lib/actions/romaneio.actions";
import type { RomaneioView } from "@/lib/types/romaneio";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatQuantity, formatWeight, parseQuantity } from "@/lib/utils/formatting";
import { previewRomaneioMaterials, type RomaneioMaterialLineView } from "@/lib/utils/romaneio";
import { errorMessage } from "@/lib/utils/supabase-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RomaneioStatusBadge } from "@/components/romaneio/RomaneioStatusBadge";
import { RomaneioItemsEditor } from "@/components/romaneio/RomaneioItemsEditor";
import {
  RomaneioMaterialsEditor,
  type MaterialLineState,
} from "@/components/romaneio/RomaneioMaterialsEditor";

interface RomaneioDetailProps {
  view: RomaneioView;
  /** O perfil edita romaneios (capacidade romaneio.edit). */
  canEditCapability: boolean;
}

function toAmountText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** Linha do preview numérico → estado do formulário (texto dos inputs). */
function toLineState(line: RomaneioMaterialLineView): MaterialLineState {
  return {
    description: line.description,
    unit: line.unit,
    quantityPlanned: line.quantityPlanned,
    received: toAmountText(line.quantityReceived),
    used: toAmountText(line.quantityUsed),
  };
}

interface HeaderState {
  shipmentDate: string;
  carrier: string;
  vehicle: string;
  notes: string;
}

function initialHeader(view: RomaneioView): HeaderState {
  return {
    shipmentDate: view.shipmentDate ?? "",
    carrier: view.carrier ?? "",
    vehicle: view.vehicle ?? "",
    notes: view.notes ?? "",
  };
}

function initialQuantities(view: RomaneioView): Record<string, string> {
  return Object.fromEntries(
    view.items.map((item) => [item.orderItemId, item.quantity > 0 ? String(item.quantity) : ""]),
  );
}

/**
 * Detalhe do romaneio: cabeçalho da carga, itens (raiz da OF) com a
 * quantidade desta carga e a devolução de matéria-prima com o bloco de
 * peso (somente leitura — conferência, emissão de NF e baixa acontecem
 * pelos botões da listagem `/romaneio`). Ações do ciclo de vida aqui:
 * ABERTO edita/exclui, CONFIRMADO/CANCELADO seguem para cancelamento.
 */
export function RomaneioDetail({ view, canEditCapability }: RomaneioDetailProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [header, setHeader] = useState<HeaderState>(() => initialHeader(view));
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    initialQuantities(view),
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Última visão do servidor já aplicada ao formulário (ver ajuste abaixo).
  const [syncedView, setSyncedView] = useState<RomaneioView>(view);

  // Ressincroniza o formulário quando o servidor envia uma visão nova
  // (salvar/excluir/cancelar chamam router.refresh()) — ajuste durante a
  // renderização, o mesmo padrão dos filtros de listagem. Editar sem
  // salvar e receber um refresh de fora descarta o rascunho local: o
  // formulário nunca fica divergente do gravado.
  if (syncedView !== view) {
    setSyncedView(view);
    setHeader(initialHeader(view));
    setQuantities(initialQuantities(view));
  }

  // Auto-reload AO VIVO: cada tecla nas quantidades dos itens recalcula
  // os itens efetivos (peso da carga) e as linhas de material na MESMA
  // renderização — sem esperar Salvar. O salvamento grava exatamente
  // estes valores (mesmo parser) e o servidor confirma no refresh;
  // fora de ABERTO o preview congela no gravado (igual ao serviço).
  const effectiveItems = view.items.map((item) => ({
    ...item,
    quantity: parseQuantity(quantities[item.orderItemId] ?? "") ?? 0,
  }));
  const materials: MaterialLineState[] = previewRomaneioMaterials({
    status: view.status,
    allocationItems: view.allocationItems,
    storedMaterials: view.storedMaterials,
    quantities,
  }).map(toLineState);

  const canEdit = view.canEdit;
  const canCancel = canEditCapability && (view.status === "CONFERIDO" || view.status === "CONFIRMADO");

  const run = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await task();
    } catch (error) {
      console.error("[RomaneioDetail]", error);
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleSave = () =>
    run("save", async () => {
      for (const item of view.items) {
        const raw = (quantities[item.orderItemId] ?? "").trim();
        if (raw !== "" && parseQuantity(raw) === null) {
          toast.error(`Quantidade inválida para o item ${item.description || "—"}.`);
          return;
        }
      }
      for (const line of materials) {
        if (line.received.trim() !== "" && parseQuantity(line.received) === null) {
          toast.error(`Quantidade recebida inválida em ${line.description}.`);
          return;
        }
        if (line.used.trim() !== "" && parseQuantity(line.used) === null) {
          toast.error(`Quantidade utilizada inválida em ${line.description}.`);
          return;
        }
      }

      const result = await saveRomaneioAction({
        id: view.id,
        orderId: view.orderId,
        shipmentDate: header.shipmentDate || null,
        carrier: header.carrier || null,
        vehicle: header.vehicle || null,
        notes: header.notes || null,
        items: view.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: parseQuantity(quantities[item.orderItemId] ?? "") ?? 0,
        })),
        materials: materials.map((line) => ({
          description: line.description,
          unit: line.unit,
          quantityPlanned: line.quantityPlanned,
          quantityReceived: parseQuantity(line.received),
          quantityUsed: parseQuantity(line.used),
        })),
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  const handleDelete = () =>
    run("delete", async () => {
      const result = await deleteRomaneioAction(view.id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setDeleteOpen(false);
      router.push("/romaneio");
    });

  const handleCancel = () =>
    run("cancel", async () => {
      const result = await cancelRomaneioAction(view.id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setCancelOpen(false);
      router.refresh();
    });

  const quantityTotal = effectiveItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const weightTotal = effectiveItems.reduce(
    (sum, item) => sum + (item.unitWeightKg === null ? 0 : item.unitWeightKg * item.quantity),
    0,
  );
  const hasAnyWeight = effectiveItems.some((item) => item.unitWeightKg !== null);

  return (
    <div className="space-y-3">
      {/* Situação */}
      <section aria-label="Situação do romaneio" className="rounded border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <RomaneioStatusBadge status={view.status} />
          <Badge variant="outline" className="px-1 py-0">{view.orderType}</Badge>
          <span className="font-medium tabular-nums">{view.orderCode}</span>
          <span className="truncate text-sm text-muted-foreground">
            {view.customerName || "Cliente não informado"}
          </span>
        </div>

        <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Entrega da OF</dt>
            <dd className="tabular-nums">{formatDate(view.orderDeliveryDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Saída</dt>
            <dd className="tabular-nums">{formatDate(view.shipmentDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Itens nesta carga</dt>
            <dd className="tabular-nums">
              {effectiveItems.filter((item) => item.quantity > 0).length} de{" "}
              {effectiveItems.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Peso da carga</dt>
            <dd className="tabular-nums">
              {hasAnyWeight ? `${formatWeight(weightTotal)} kg` : "—"}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-muted-foreground">
          Criado em {formatDateTime(view.createdAt)}
          {view.conferenceAcceptedAt
            ? ` · Conferência aceita em ${formatDateTime(view.conferenceAcceptedAt)}${
                view.conferenceAcceptedByName ? ` por ${view.conferenceAcceptedByName}` : ""
              }`
            : ""}
          {view.emittedAt ? ` · Confirmado em ${formatDateTime(view.emittedAt)}` : ""}
        </p>
      </section>

      {/* Carga */}
      <section aria-label="Dados da carga" className="rounded border bg-card p-3">
        <h2 className="mb-3 text-sm font-semibold">Carga</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="romaneio-saida" className="text-xs text-muted-foreground">
              Data de saída
            </Label>
            <Input
              id="romaneio-saida"
              type="date"
              value={header.shipmentDate}
              disabled={!canEdit}
              onChange={(event) =>
                setHeader((current) => ({ ...current, shipmentDate: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-transportadora" className="text-xs text-muted-foreground">
              Transportadora
            </Label>
            <Input
              id="romaneio-transportadora"
              type="text"
              value={header.carrier}
              disabled={!canEdit}
              maxLength={200}
              onChange={(event) =>
                setHeader((current) => ({ ...current, carrier: event.target.value }))
              }
              placeholder="Opcional"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-veiculo" className="text-xs text-muted-foreground">
              Veículo / placa
            </Label>
            <Input
              id="romaneio-veiculo"
              type="text"
              value={header.vehicle}
              disabled={!canEdit}
              maxLength={100}
              onChange={(event) =>
                setHeader((current) => ({ ...current, vehicle: event.target.value }))
              }
              placeholder="Opcional"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-observacoes" className="text-xs text-muted-foreground">
              Observações
            </Label>
            <Textarea
              id="romaneio-observacoes"
              value={header.notes}
              disabled={!canEdit}
              maxLength={1000}
              rows={2}
              onChange={(event) =>
                setHeader((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder="Opcional"
            />
          </div>
        </div>
      </section>

      {/* Itens */}
      <section aria-label="Itens da carga" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Itens da carga (raiz da OF)</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            Qtd total: {formatQuantity(quantityTotal)}
            {hasAnyWeight ? ` · Peso: ${formatWeight(weightTotal)} kg` : ""}
          </p>
        </div>
        <RomaneioItemsEditor
          items={effectiveItems}
          processes={view.processes}
          canEdit={canEdit}
          quantities={quantities}
          onQuantityChange={(orderItemId, value) =>
            setQuantities((current) => ({ ...current, [orderItemId]: value }))
          }
        />
      </section>

      {/* Devolução de matéria-prima + totalizador de peso (lançamento é na ficha) */}
      <section aria-label="Devolução de matéria-prima" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Devolução de matéria-prima</h2>
          <p className="text-xs text-muted-foreground">
            As quantidades são lançadas na ficha de conferência — aqui são somente leitura.
          </p>
        </div>
        <RomaneioMaterialsEditor
          materials={materials}
          canEdit={false}
          ofTotals={view.ofMaterialTotals}
          weightItems={effectiveItems}
        />
      </section>

      {/* Ações */}
      {canEdit || canCancel ? (
        <section
          aria-label="Ações do romaneio"
          className="flex flex-wrap items-center justify-end gap-2"
        >
          {canEdit ? (
            <>
              <Button
                type="button"
                disabled={busy !== null}
                onClick={() => void handleSave()}
              >
                {busy === "save" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                Salvar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setDeleteOpen(true)}
              >
                {busy === "delete" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
                Excluir
              </Button>
            </>
          ) : null}

          {canCancel ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => setCancelOpen(true)}
            >
              {busy === "cancel" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
              Cancelar romaneio
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* Confirmação de exclusão (só ABERTO) */}
      <Dialog open={deleteOpen} onOpenChange={(nextOpen) => !busy && setDeleteOpen(nextOpen)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir romaneio nº {view.number}</DialogTitle>
            <DialogDescription>
              A exclusão é DEFINITIVA — itens, materiais e o próprio romaneio saem do sistema sem
              registro no histórico (o número não retorna). Use o cancelamento para romaneios já
              conferidos ou confirmados. Confirma?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy !== null}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void handleDelete()}
            >
              {busy === "delete" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {busy === "delete" ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de cancelamento */}
      <Dialog open={cancelOpen} onOpenChange={(nextOpen) => !busy && setCancelOpen(nextOpen)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar romaneio nº {view.number}</DialogTitle>
            <DialogDescription>
              {view.status === "CONFIRMADO"
                ? "Cancelar um romaneio confirmado DEVOLVE as quantidades à pendência de expedição da OF " +
                  view.orderCode +
                  " (a baixa é desfeita automaticamente) e mantém o registro no histórico. Confirma?"
                : "O cancelamento mantém o registro no histórico e libera o romaneio em aberto que esta OF pode vir a ter. Confirma?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={busy !== null}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void handleCancel()}
            >
              {busy === "cancel" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {busy === "cancel" ? "Cancelando…" : "Cancelar romaneio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
