"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardCheck, Loader2, Printer, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  cancelRomaneioAction,
  confirmRomaneioAction,
  deleteRomaneioAction,
  saveRomaneioAction,
  saveRomaneioNfAction,
  signRomaneioConferenceAction,
} from "@/lib/actions/romaneio.actions";
import type { RomaneioView } from "@/lib/types/romaneio";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
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

/** Converte texto digitado em número ("2,5" → 2.5); null quando vazio/inválido. */
function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return null;
  if (!/^\d*\.?\d+$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toAmountText(value: number | null): string {
  return value === null ? "" : String(value);
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

function initialMaterials(view: RomaneioView): MaterialLineState[] {
  return view.materials.map((line) => ({
    description: line.description,
    unit: line.unit,
    quantityPlanned: line.quantityPlanned,
    received: toAmountText(line.quantityReceived),
    used: toAmountText(line.quantityUsed),
  }));
}

/**
 * Detalhe do romaneio: cabeçalho da carga, itens (raiz da OF) com a
 * quantidade desta carga, devolução de matéria-prima (previsto ×
 * informado), painel de conferência, números de NF e as ações do ciclo
 * de vida — MONTADO edita/exclui, CONFERIDO confirma (baixa), e
 * CONFIRMADO pode ser cancelado (a baixa se restaura sozinha).
 */
export function RomaneioDetail({ view, canEditCapability }: RomaneioDetailProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [header, setHeader] = useState<HeaderState>(() => initialHeader(view));
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    initialQuantities(view),
  );
  const [materials, setMaterials] = useState<MaterialLineState[]>(() => initialMaterials(view));
  const [conferenceNotes, setConferenceNotes] = useState("");
  const [nf, setNf] = useState({
    nfNumber: view.nfNumber ?? "",
    returnNfNumber: view.returnNfNumber ?? "",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Última visão do servidor já aplicada ao formulário (ver ajuste abaixo).
  const [syncedView, setSyncedView] = useState<RomaneioView>(view);

  // Ressincroniza o formulário quando o servidor envia uma visão nova
  // (salvar/confirmar/excluir/cancelar chamam router.refresh()) — ajuste
  // durante a renderização, o mesmo padrão dos filtros de listagem. Editar
  // sem salvar e receber um refresh de fora descarta o rascunho local: o
  // formulário nunca fica divergente do gravado.
  if (syncedView !== view) {
    setSyncedView(view);
    setHeader(initialHeader(view));
    setQuantities(initialQuantities(view));
    setMaterials(initialMaterials(view));
    setNf({ nfNumber: view.nfNumber ?? "", returnNfNumber: view.returnNfNumber ?? "" });
  }

  const canEdit = view.canEdit;
  const canEditNf = canEditCapability && view.status !== "CANCELADO";
  const isMounted = view.status === "MONTADO";
  const isConferred = view.status === "CONFERIDO";
  const canCancel = canEditCapability && (isConferred || view.status === "CONFIRMADO");

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

  const handleSignConference = () =>
    run("conference", async () => {
      const result = await signRomaneioConferenceAction(
        view.id,
        conferenceNotes.trim() || null,
      );
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setConferenceNotes("");
      router.refresh();
    });

  const handleConfirm = () =>
    run("confirm", async () => {
      const result = await confirmRomaneioAction(view.id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setConfirmOpen(false);
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

  const handleSaveNf = () =>
    run("nf", async () => {
      const result = await saveRomaneioNfAction(view.id, {
        nfNumber: nf.nfNumber.trim() || null,
        returnNfNumber: nf.returnNfNumber.trim() || null,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  const quantityTotal = view.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const weightTotal = view.items.reduce(
    (sum, item) => sum + (item.unitWeightKg === null ? 0 : item.unitWeightKg * item.quantity),
    0,
  );
  const hasAnyWeight = view.items.some((item) => item.unitWeightKg !== null);

  return (
    <div className="space-y-3">
      {/* Situação + pré-requisitos de confirmação */}
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
              {view.items.filter((item) => item.quantity > 0).length} de {view.items.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Peso da carga</dt>
            <dd className="tabular-nums">
              {hasAnyWeight ? `${formatWeight(weightTotal)} kg` : "—"}
            </dd>
          </div>
        </dl>

        {isMounted || isConferred ? (
          view.confirmation.canConfirm ? (
            <p className="mt-3 rounded border border-status-done-bg bg-status-done/10 px-3 py-2 text-sm text-status-done">
              Pronto para confirmar — todos os pré-requisitos atendidos.
            </p>
          ) : (
            <div className="mt-3 rounded border border-status-progress-bg bg-status-progress/10 px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-status-progress">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Para confirmar, falta:
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                {view.confirmation.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )
        ) : null}

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
          items={view.items}
          canEdit={canEdit}
          quantities={quantities}
          onQuantityChange={(orderItemId, value) =>
            setQuantities((current) => ({ ...current, [orderItemId]: value }))
          }
        />
      </section>

      {/* Devolução de matéria-prima */}
      <section aria-label="Devolução de matéria-prima" className="space-y-3">
        <h2 className="text-sm font-semibold">Devolução de matéria-prima</h2>
        {materials.length === 0 ? (
          <p className="rounded border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum material alocado para os itens desta carga. Inclua itens com matéria-prima e
            salve para calcular a devolução.
          </p>
        ) : (
          <RomaneioMaterialsEditor
            materials={materials}
            canEdit={canEdit}
            ofTotals={view.ofMaterialTotals}
            onFieldChange={(index, field, value) =>
              setMaterials((current) =>
                current.map((line, lineIndex) =>
                  lineIndex === index ? { ...line, [field]: value } : line,
                ),
              )
            }
          />
        )}
      </section>

      {/* Conferência */}
      <section aria-label="Conferência" className="rounded border bg-card p-3">
        <h2 className="text-sm font-semibold">Conferência</h2>
        {view.conferenceAcceptedAt ? (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              Aceite registrado em{" "}
              <span className="font-medium tabular-nums">
                {formatDateTime(view.conferenceAcceptedAt)}
              </span>
              {view.conferenceAcceptedByName ? (
                <>
                  {" "}
                  por <span className="font-medium">{view.conferenceAcceptedByName}</span>
                </>
              ) : null}
              .
            </p>
            {view.conferenceNotes ? (
              <p className="text-muted-foreground">Obs.: {view.conferenceNotes}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Aceite ainda não sinalizado — imprima a folha de conferência e registre o aceite
            nela.
          </p>
        )}

        {!isMounted && !isConferred ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/romaneio/${view.id}/conferencia`}>
                <Printer className="h-4 w-4" aria-hidden />
                Abrir folha de conferência
              </Link>
            </Button>
            {canEdit ? (
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <div className="min-w-52 flex-1 space-y-1">
                  <Label
                    htmlFor="romaneio-conferencia-obs"
                    className="text-xs text-muted-foreground"
                  >
                    Observação do aceite (opcional)
                  </Label>
                  <Textarea
                    id="romaneio-conferencia-obs"
                    value={conferenceNotes}
                    maxLength={500}
                    rows={1}
                    onChange={(event) => setConferenceNotes(event.target.value)}
                    placeholder="Ex.: carga conferida com o cliente, avarias inexistentes…"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void handleSignConference()}
                >
                  {busy === "conference" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <ClipboardCheck className="h-4 w-4" aria-hidden />
                  )}
                  Sinalizar aceite
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Notas fiscais */}
      <section aria-label="Notas fiscais" className="rounded border bg-card p-3">
        <h2 className="text-sm font-semibold">Notas fiscais</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          O sistema só registra os números — a emissão acontece no emissor externo. A NF de
          saída é exigida para confirmar o romaneio.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="romaneio-nf" className="text-xs text-muted-foreground">
              NF de saída
            </Label>
            <Input
              id="romaneio-nf"
              type="text"
              value={nf.nfNumber}
              disabled={!canEditNf}
              maxLength={60}
              onChange={(event) =>
                setNf((current) => ({ ...current, nfNumber: event.target.value }))
              }
              placeholder="Número da NF de saída"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-nf-devolucao" className="text-xs text-muted-foreground">
              NF de devolução
            </Label>
            <Input
              id="romaneio-nf-devolucao"
              type="text"
              value={nf.returnNfNumber}
              disabled={!canEditNf}
              maxLength={60}
              onChange={(event) =>
                setNf((current) => ({ ...current, returnNfNumber: event.target.value }))
              }
              placeholder="Exige NF de saída e materiais informados"
              autoComplete="off"
            />
          </div>
        </div>
        {canEditNf ? (
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy !== null}
              onClick={() => void handleSaveNf()}
            >
              {busy === "nf" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Salvar números de NF
            </Button>
          </div>
        ) : null}
      </section>

      {/* Ações */}
      {canEdit || isConferred || canCancel ? (
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

          {canEditCapability && isConferred ? (
            <Button
              type="button"
              disabled={!view.confirmation.canConfirm || busy !== null}
              title={
                view.confirmation.canConfirm
                  ? "Registra a NF como saída e baixa os itens na pendência da OF"
                  : view.confirmation.blockers[0]
              }
              onClick={() => setConfirmOpen(true)}
            >
              {busy === "confirm" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Confirmar romaneio
            </Button>
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

      {/* Confirmação de confirmação (baixa) */}
      <Dialog open={confirmOpen} onOpenChange={(nextOpen) => !busy && setConfirmOpen(nextOpen)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar romaneio nº {view.number}</DialogTitle>
            <DialogDescription>
              A confirmação registra a NF {view.nfNumber || ""} como saída e BAIXA as quantidades
              na pendência de expedição da OF {view.orderCode}. Depois disso cabeçalho, itens e
              materiais ficam travados — só os números de NF continuam editáveis, e cancelar
              depois devolve as quantidades à OF. Confirma?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy !== null}>
              Voltar
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleConfirm()}
            >
              {busy === "confirm" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {busy === "confirm" ? "Confirmando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão (só MONTADO) */}
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
                : "O cancelamento mantém o registro no histórico e libera o romaneio em montagem que esta OF pode vir a ter. Confirma?"}
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
