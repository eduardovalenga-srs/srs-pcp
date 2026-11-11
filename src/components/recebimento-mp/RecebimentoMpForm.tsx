"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteMpReceiptAction,
  loadMpReceiptOrderAction,
  saveMpReceiptAction,
} from "@/lib/actions/mp-receipt.actions";
import { MP_RECEIPT_STATE_LABELS, mpReceiptClass } from "@/lib/utils/mp-receipt";
import type {
  MpReceiptCustomerOption,
  MpReceiptHistoryEntry,
} from "@/lib/types/mp-receipt";
import type { MpReceiptItem } from "@/lib/repositories/mp-receipt.repository";
import { formatBusinessDate, formatDate, formatDateTime } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboboxOption } from "@/components/shared/combobox";
import { MaterialsList } from "@/components/shared/MaterialsList";
import { OrderStatusBadge } from "@/components/shared/StatusBadges";

const NO_CUSTOMER_KEY = "__sem_cliente__";

function customerKey(customer: MpReceiptCustomerOption): string {
  return customer.customerName ?? NO_CUSTOMER_KEY;
}

/** Opções do combobox de clientes (nome + nº de OFs com pendência). */
export function customerComboboxOptions(
  customers: readonly MpReceiptCustomerOption[],
): ComboboxOption[] {
  return customers.map((customer) => ({
    value: customerKey(customer),
    label: customer.customerName ?? "Cliente não informado",
    hint: `${customer.ofCount} ${customer.ofCount === 1 ? "OF" : "OFs"} com pendência`,
  }));
}

/** Opções do combobox de OFs do cliente escolhido (pendências de MP). */
export function orderComboboxOptions(ofs: MpReceiptCustomerOption["ofs"]): ComboboxOption[] {
  return ofs.map((of) => ({
    value: of.orderId,
    label: of.code,
    hint: of.deliveryDate ? `Entrega ${formatDate(of.deliveryDate)}` : "Sem data de entrega",
    badge:
      of.pendingKg !== null
        ? `${formatWeight(of.pendingKg)} pendentes`
        : `${of.pendingItems} ${of.pendingItems === 1 ? "item" : "itens"}`,
  }));
}

/** Lê um texto de input ("2,5" / "2.5" / "") como kg. */
function parseKg(text: string | undefined): number {
  const quantity = Number.parseFloat((text ?? "").replace(",", "."));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

/** Itens com kg informado (> 0) — o payload do recebimento. */
export function markedMpItems(
  items: readonly MpReceiptItem[],
  quantities: Record<string, string>,
): { orderItemId: string; quantityKg: number }[] {
  return items.flatMap((item) => {
    const quantityKg = parseKg(quantities[item.orderItemId]);
    return quantityKg > 0 ? [{ orderItemId: item.orderItemId, quantityKg }] : [];
  });
}

/** Pelo menos um item com kg válido. */
export function canSaveMpReceipt(
  items: readonly MpReceiptItem[],
  quantities: Record<string, string>,
): boolean {
  return markedMpItems(items, quantities).length > 0;
}

/** Default do input: o que ainda falta receber (sem peso → vazio). */
function defaultQuantity(item: MpReceiptItem): string {
  if (item.state === "TOTAL") return "";
  return item.pendingKg !== null && item.pendingKg > 0 ? String(item.pendingKg) : "";
}

interface RecebimentoMpFormProps {
  customers: MpReceiptCustomerOption[];
  /** Escrita liberada (`mp_receipt.edit`) — sem ela a tela é consulta. */
  canEdit: boolean;
}

/**
 * /recebimento-mp: seletor em cascata (cliente → OFs com pendência) +
 * kg recebidos por LINHA (item filho, ou pai sem filhos; default =
 * pendência) + histórico com exclusão em dois passos. O salvamento é
 * um registro por ação (RPC transacional) e o espelho da coluna MP é
 * recalculado no banco — no pai, como agregado dos filhos (057).
 */
export function RecebimentoMpForm({ customers, canEdit }: RecebimentoMpFormProps) {
  const router = useRouter();

  const [customerValue, setCustomerValue] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [items, setItems] = useState<MpReceiptItem[] | null>(null);
  const [history, setHistory] = useState<MpReceiptHistoryEntry[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const customer = useMemo(
    () => customers.find((entry) => customerKey(entry) === customerValue) ?? null,
    [customerValue, customers],
  );
  const customerOptions = useMemo(() => customerComboboxOptions(customers), [customers]);
  const orderOptions = useMemo(
    () => orderComboboxOptions(customer?.ofs ?? []),
    [customer],
  );
  const selectedOf = useMemo(
    () => customer?.ofs.find((of) => of.orderId === orderId) ?? null,
    [customer, orderId],
  );

  // Troca de cliente zera a cascata (OF, itens e histórico).
  const onCustomerChange = (next: string) => {
    setCustomerValue(next);
    setOrderId(null);
    setItems(null);
    setHistory([]);
    setQuantities({});
    setNotes("");
    setDeletingId(null);
  };

  // Troca de OF recarrega itens + histórico e devolve os inputs com a
  // pendência de cada item.
  const onOrderChange = async (next: string) => {
    setOrderId(next);
    setItems(null);
    setHistory([]);
    setQuantities({});
    setNotes("");
    setDeletingId(null);
    if (!next) return;

    setLoading(true);
    try {
      const result = await loadMpReceiptOrderAction(next);
      if (!result.success) {
        toast.error(result.message || "Não foi possível carregar os itens da OF.");
        return;
      }
      setItems(result.items);
      setHistory(result.history);
      setQuantities(Object.fromEntries(result.items.map((item) => [item.orderItemId, defaultQuantity(item)])));
    } catch (error) {
      console.error("[RecebimentoMpForm]", error);
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const reloadOrder = async (currentOrderId: string) => {
    const result = await loadMpReceiptOrderAction(currentOrderId);
    if (!result.success) return;
    setItems(result.items);
    setHistory(result.history);
    setQuantities(Object.fromEntries(result.items.map((item) => [item.orderItemId, defaultQuantity(item)])));
  };

  const handleSave = async () => {
    if (saving || !selectedOf || !items) return;

    const marked = markedMpItems(items, quantities);
    if (marked.length === 0) {
      toast.error("Informe os kg recebidos de pelo menos um item.");
      return;
    }

    setSaving(true);
    try {
      const result = await saveMpReceiptAction({
        orderId: selectedOf.orderId,
        notes,
        items: marked,
      });
      if (!result.success) {
        toast.error(result.message || "Não foi possível registrar o recebimento.");
        return;
      }
      toast.success(result.message);
      await reloadOrder(selectedOf.orderId);
      router.refresh();
    } catch (error) {
      console.error("[RecebimentoMpForm]", error);
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (receiptId: string) => {
    if (!selectedOf || deletingId !== receiptId) {
      // Primeiro clique arma a confirmação; o segundo exclui.
      setDeletingId(receiptId);
      return;
    }

    try {
      const result = await deleteMpReceiptAction(receiptId);
      if (!result.success) {
        toast.error(result.message || "Não foi possível excluir o recebimento.");
        return;
      }
      toast.success(result.message);
      await reloadOrder(selectedOf.orderId);
      router.refresh();
    } catch (error) {
      console.error("[RecebimentoMpForm]", error);
      toast.error(errorMessage(error));
    } finally {
      setDeletingId(null);
    }
  };

  const marked = items ? markedMpItems(items, quantities) : [];
  const markedKg = marked.reduce((total, item) => total + item.quantityKg, 0);

  return (
    <section aria-label="Recebimento de matéria-prima" className="space-y-3">
      <div className="rounded border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="mp-recebimento-cliente" className="text-xs text-muted-foreground">
              Cliente
            </Label>
            <Combobox
              id="mp-recebimento-cliente"
              label="Cliente"
              placeholder="Selecione o cliente…"
              options={customerOptions}
              value={customerValue}
              onChange={onCustomerChange}
              disabled={customers.length === 0}
              emptyMessage="Nenhum cliente encontrado."
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="mp-recebimento-of" className="text-xs text-muted-foreground">
              OF
            </Label>
            <Combobox
              id="mp-recebimento-of"
              label="OF"
              placeholder={customer ? "Selecione a OF…" : "Escolha primeiro o cliente…"}
              options={orderOptions}
              value={orderId}
              onChange={(next) => void onOrderChange(next)}
              disabled={!customer || loading}
              emptyMessage="Nenhuma OF com pendência para este cliente."
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              {selectedOf
                ? "Informe os kg recebidos — parcial ou total, um registro por ação."
                : "Selecione o cliente e a OF para registrar o recebimento."}
            </p>
            {selectedOf ? (
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="px-1 py-0">
                  {selectedOf.type}
                </Badge>
                <span className="font-medium text-foreground tabular-nums">{selectedOf.code}</span>
                <OrderStatusBadge status={selectedOf.status} />
                <span className="tabular-nums">
                  {selectedOf.pendingItems} {selectedOf.pendingItems === 1 ? "item" : "itens"} com
                  pendência
                </span>
                {selectedOf.pendingKg !== null ? (
                  <span className="tabular-nums">{formatWeight(selectedOf.pendingKg)} pendentes</span>
                ) : null}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            id="mp-recebimento-confirmar"
            disabled={!canEdit || saving || !items || !canSaveMpReceipt(items, quantities)}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PackageCheck className="h-4 w-4" aria-hidden />
            )}
            Registrar recebimento
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando itens da OF…
        </div>
      ) : null}

      {items ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Itens da OF</h2>
            <p className="text-xs text-muted-foreground">
              Uma linha por item filho — o pai e a matéria-prima aparecem nas colunas (itens pai sem
              filhos entram como linha própria). O campo nasce com o que falta receber — deixe vazio
              (ou 0) nas linhas sem recebimento nesta ação.
            </p>
          </div>

          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Item pai
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Matéria-prima
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Qtd.
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Peso un.
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Planejado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Já recebido
                  </th>
                  <th scope="col" className="px-3 py-2 text-center font-medium">
                    Situação
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Kg neste recebimento
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.orderItemId} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="block font-medium text-foreground">{item.description}</span>
                      {item.code ? (
                        <span className="block text-xs text-muted-foreground">{item.code}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.parentLabel ?? "—"}</td>
                    <td className="px-3 py-2">
                      <MaterialsList materials={item.materials} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQuantity(item.quantity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(item.unitWeightKg)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(item.plannedKg)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(item.receivedKg)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex rounded border px-1.5 py-0.5 text-xs ${mpReceiptClass(item.state)}`}
                        title={MP_RECEIPT_STATE_LABELS[item.state]}
                      >
                        {MP_RECEIPT_STATE_LABELS[item.state]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        id={`mp-kg-${item.orderItemId}`}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={quantities[item.orderItemId] ?? ""}
                        onChange={(event) =>
                          setQuantities((previous) => ({
                            ...previous,
                            [item.orderItemId]: event.target.value,
                          }))
                        }
                        disabled={!canEdit}
                        className="ml-auto w-32 text-right tabular-nums"
                        aria-label={`Kg recebidos de ${item.description}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded border bg-card p-3">
            <div className="space-y-1 grow">
              <Label htmlFor="mp-recebimento-notas" className="text-xs text-muted-foreground">
                Observação
              </Label>
              <Input
                id="mp-recebimento-notas"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={!canEdit}
                placeholder="Ex.: nota fiscal, transportadora, conferência…"
                maxLength={1000}
              />
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              Neste registro: {marked.length} {marked.length === 1 ? "item" : "itens"} ·{" "}
              {formatWeight(markedKg)}
            </p>
          </div>
        </div>
      ) : null}

      {items && history.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">Histórico de recebimentos</h2>
          </div>

          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Nº
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Data
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Usuário
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Itens (kg)
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Observação
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2 tabular-nums">{entry.number}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {entry.receiptDate ? formatBusinessDate(entry.receiptDate) : "—"}
                    </td>
                    <td className="px-3 py-2">{entry.userName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <ul className="space-y-0.5">
                        {entry.items.map((item, index) => (
                          <li key={`${entry.id}-${index}`} className="tabular-nums">
                            {item.description ?? item.orderItemId}: {formatWeight(item.quantityKg)}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.notes ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant={deletingId === entry.id ? "destructive" : "ghost"}
                        size="sm"
                        disabled={!canEdit}
                        onClick={() => void handleDelete(entry.id)}
                        aria-label={
                          deletingId === entry.id
                            ? `Confirmar exclusão do recebimento ${entry.number}`
                            : `Excluir recebimento ${entry.number}`
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {deletingId === entry.id ? "Confirmar" : "Excluir"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Criado em {history[0] ? formatDateTime(history[0].createdAt) : ""}. A exclusão corrige o
            registro e recalcula o espelho da coluna MP.
          </p>
        </div>
      ) : null}
    </section>
  );
}
