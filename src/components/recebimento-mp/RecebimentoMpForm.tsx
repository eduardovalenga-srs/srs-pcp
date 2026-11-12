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
import type {
  MpReceiptCustomerOption,
  MpReceiptHistoryEntry,
  MpReceiptMaterial,
} from "@/lib/types/mp-receipt";
import { formatBusinessDate, formatDate, formatDateTime, todayISODate } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";
import { formatWeight } from "@/lib/utils/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboboxOption } from "@/components/shared/combobox";
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
        : `${of.pendingMaterials} ${of.pendingMaterials === 1 ? "matéria-prima" : "matérias-primas"}`,
  }));
}

/** Lê um texto de input ("2,5" / "2.5" / "") como kg. */
function parseKg(text: string | undefined): number {
  const quantity = Number.parseFloat((text ?? "").replace(",", "."));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

/**
 * Materiais com kg informado (> 0) — o payload da nota de entrada.
 * A chave do material (`materialKey`) identifica a linha.
 */
export function markedMpMaterials(
  materials: readonly MpReceiptMaterial[],
  quantities: Record<string, string>,
): {
  materialKey: string;
  description: string;
  unit: string;
  quantityKg: number;
}[] {
  return materials.flatMap((material) => {
    const quantityKg = parseKg(quantities[material.materialKey]);
    return quantityKg > 0
      ? [
          {
            materialKey: material.materialKey,
            description: material.description,
            unit: material.unit,
            quantityKg,
          },
        ]
      : [];
  });
}

/** Pelo menos um material com kg válido. */
export function canSaveMpReceipt(
  materials: readonly MpReceiptMaterial[],
  quantities: Record<string, string>,
): boolean {
  return markedMpMaterials(materials, quantities).length > 0;
}

/**
 * Campos de uma NOVA nota: TODOS vazios.
 *
 * Deliberado: um default preenchido (o Saldo) entrava na nota junto —
 * o material que não tinha chegado era gravado como recebido por
 * completo, zerava o saldo e liberava a produção sem o material. O
 * que entra na nota é só o que o clerk DIGITOU; o botão "= saldo"
 * preenche o saldo sob demanda (ação explícita, não default).
 */
export function initialMpQuantities(): Record<string, string> {
  return {};
}

/**
 * Valor EXIBIDO no campo de um material: **0** enquanto o clerk não
 * digita nada (o campo nunca fica em branco — "zerado" é o estado de
 * "não veio nesta nota"), e o que foi digitado depois disso.
 *
 * Campo LIMPADO volta a 0 (não fica em branco): limpar é o mesmo que
 * dizer "zero nesta nota".
 *
 * O estado interno continua vazio (`initialMpQuantities`): o 0 é
 * apresentação, não um recebimento.
 */
export function mpQuantityValue(
  quantities: Record<string, string>,
  materialKey: string,
): string {
  const raw = quantities[materialKey];
  return raw === undefined || raw === "" ? "0" : raw;
}

interface RecebimentoMpFormProps {
  customers: MpReceiptCustomerOption[];
  /** Escrita liberada (`mp_receipt.edit`) — sem ela a tela é consulta. */
  canEdit: boolean;
}

/**
 * /recebimento-mp: seletor em cascata (cliente → OFs com pendência) +
 * NOTA DE ENTRADA (nº + data) + o peso recebido de cada MATÉRIA-PRIMA
 * (campos ZERADOS — só entra na nota o que foi digitado) + histórico
 * com exclusão em dois passos.
 *
 * O salvamento é uma nota por ação (RPC transacional) e o espelho da
 * coluna MP é recalculado no banco — por preenchimento sequencial do
 * material na ordem de produção dos itens (059).
 */
export function RecebimentoMpForm({ customers, canEdit }: RecebimentoMpFormProps) {
  const router = useRouter();

  const [customerValue, setCustomerValue] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MpReceiptMaterial[] | null>(null);
  const [history, setHistory] = useState<MpReceiptHistoryEntry[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [entryNumber, setEntryNumber] = useState("");
  const [entryDate, setEntryDate] = useState("");
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

  // Zera a cascata (OF, materiais, nota e histórico).
  const resetEntry = () => {
    setMaterials(null);
    setHistory([]);
    setQuantities({});
    setEntryNumber("");
    setEntryDate(todayISODate());
    setNotes("");
    setDeletingId(null);
  };

  // Troca de cliente zera a cascata.
  const onCustomerChange = (next: string) => {
    setCustomerValue(next);
    setOrderId(null);
    resetEntry();
  };

  // Troca de OF recarrega materiais + histórico e devolve os inputs com
  // o saldo de cada matéria-prima.
  const onOrderChange = async (next: string) => {
    setOrderId(next);
    resetEntry();

    if (!next) return;

    setLoading(true);
    try {
      const result = await loadMpReceiptOrderAction(next);
      if (!result.success) {
        toast.error(result.message || "Não foi possível carregar as matérias-primas da OF.");
        return;
      }
      setMaterials(result.materials);
      setHistory(result.history);
      setQuantities(initialMpQuantities());
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
    setMaterials(result.materials);
    setHistory(result.history);
    setQuantities(initialMpQuantities());
  };

  const handleSave = async () => {
    if (saving || !selectedOf || !materials) return;

    const marked = markedMpMaterials(materials, quantities);
    if (marked.length === 0) {
      toast.error("Informe o peso recebido de pelo menos uma matéria-prima.");
      return;
    }
    if (!entryNumber.trim()) {
      toast.error("Informe o número da nota de entrada.");
      return;
    }

    setSaving(true);
    try {
      const result = await saveMpReceiptAction({
        orderId: selectedOf.orderId,
        entryNumber: entryNumber.trim(),
        entryDate: entryDate || null,
        notes,
        materials: marked,
      });
      if (!result.success) {
        toast.error(result.message || "Não foi possível registrar a nota de entrada.");
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
        toast.error(result.message || "Não foi possível excluir a nota de entrada.");
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

  const marked = materials ? markedMpMaterials(materials, quantities) : [];
  const markedKg = marked.reduce((total, material) => total + material.quantityKg, 0);

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
                ? "Informe a nota de entrada e o peso recebido de cada matéria-prima."
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
                  {selectedOf.pendingMaterials}{" "}
                  {selectedOf.pendingMaterials === 1 ? "matéria-prima" : "matérias-primas"} com
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
            disabled={!canEdit || saving || !materials || !canSaveMpReceipt(materials, quantities)}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PackageCheck className="h-4 w-4" aria-hidden />
            )}
            Registrar nota de entrada
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando matérias-primas da OF…
        </div>
      ) : null}

      {materials ? (
        <div className="space-y-2">
          {/* NOTA DE ENTRADA: nº + data (cabeçalho da nota). */}
          <div className="grid gap-3 rounded border bg-card p-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="mp-nota-numero" className="text-xs text-muted-foreground">
                Nº da nota de entrada
              </Label>
              <Input
                id="mp-nota-numero"
                value={entryNumber}
                onChange={(event) => setEntryNumber(event.target.value)}
                disabled={!canEdit}
                placeholder="Ex.: 12345"
                maxLength={100}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="mp-nota-data" className="text-xs text-muted-foreground">
                Data da nota de entrada
              </Label>
              <Input
                id="mp-nota-data"
                type="date"
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value)}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="mp-recebimento-notas" className="text-xs text-muted-foreground">
                Observação
              </Label>
              <Input
                id="mp-recebimento-notas"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={!canEdit}
                placeholder="Ex.: transportadora, conferência…"
                maxLength={1000}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Matérias-primas da OF</h2>
            <p className="text-xs text-muted-foreground">
              Uma linha por matéria-prima — o peso total soma os itens que a consomem. Preencha
              só os materiais que vieram <strong>nesta nota</strong>: os campos começam vazios e
              material sem valor não entra no registro. Use “= saldo” para registrar o material
              inteiro.
            </p>
          </div>

          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Matéria-prima
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    UM
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Peso total
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Saldo
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Recebido nesta nota
                  </th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.materialKey} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="block font-medium text-foreground">{material.description}</span>
                      {material.receivedKg > 0 ? (
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {formatWeight(material.receivedKg)} já recebidos
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{material.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(material.totalKg)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(material.balanceKg)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          id={`mp-kg-${material.materialKey}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={mpQuantityValue(quantities, material.materialKey)}
                          onChange={(event) =>
                            setQuantities((previous) => ({
                              ...previous,
                              [material.materialKey]: event.target.value,
                            }))
                          }
                          onFocus={(event) => {
                            // Campo ainda no 0 (intocado): seleciona o
                            // texto para o clerk DIGITAR por cima. Com
                            // valor já lançado, o cursor fica normal —
                            // dá para acrescentar dígitos (25 → 250).
                            if (event.target.value === "0") event.target.select();
                          }}
                          disabled={!canEdit}
                          className="w-32 text-right tabular-nums"
                          aria-label={`Peso recebido de ${material.description} nesta nota`}
                        />
                        {material.balanceKg > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!canEdit}
                            onClick={() =>
                              setQuantities((previous) => ({
                                ...previous,
                                [material.materialKey]: String(material.balanceKg),
                              }))
                            }
                            title={`Preencher com o saldo (${formatWeight(material.balanceKg)} kg)`}
                            aria-label={`Preencher com o saldo de ${material.description}`}
                            className="h-9 shrink-0 px-2 text-xs text-muted-foreground"
                          >
                            = saldo
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded border bg-card p-3">
            <p className="text-sm text-muted-foreground">
              Nesta nota: {marked.length}{" "}
              {marked.length === 1 ? "matéria-prima" : "matérias-primas"} ·{" "}
              <span className="tabular-nums">{formatWeight(markedKg)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              O material recebido cobre os itens na ordem de produção — um item só fecha quando o
              material dele chega.
            </p>
          </div>
        </div>
      ) : null}

      {materials && history.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">Histórico de notas de entrada</h2>
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
                    Matérias-primas (kg)
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
                    <td className="px-3 py-2 tabular-nums">{entry.entryNumber || entry.number}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {entry.entryDate ? formatBusinessDate(entry.entryDate) : "—"}
                    </td>
                    <td className="px-3 py-2">{entry.userName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <ul className="space-y-0.5">
                        {entry.materials.map((material, index) => (
                          <li key={`${entry.id}-${index}`} className="tabular-nums">
                            {material.description}: {formatWeight(material.quantityKg)}
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
                            ? `Confirmar exclusão da nota de entrada ${entry.entryNumber}`
                            : `Excluir nota de entrada ${entry.entryNumber}`
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
