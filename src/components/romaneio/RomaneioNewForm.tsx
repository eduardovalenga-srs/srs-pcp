"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  createRomaneioAction,
  getRomaneioOrderItemsAction,
} from "@/lib/actions/romaneio.actions";
import type {
  RomaneioCandidate,
  RomaneioCustomerOption,
  RomaneioOrderItem,
} from "@/lib/types/romaneio";
import { formatDate, isValidISODate } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboboxOption } from "@/components/shared/combobox";
import { OrderStatusBadge } from "@/components/shared/StatusBadges";
import { RomaneioItemsEditor } from "@/components/romaneio/RomaneioItemsEditor";

const NO_CUSTOMER_KEY = "__sem_cliente__";

/** Valor do combobox de cliente (bucket de OFs sem cliente tem chave própria). */
function customerKey(customer: RomaneioCustomerOption): string {
  return customer.customerName ?? NO_CUSTOMER_KEY;
}

/** Opções do combobox de clientes: nome + contagem de OFs disponíveis. */
export function customerComboboxOptions(
  customers: readonly RomaneioCustomerOption[],
): ComboboxOption[] {
  return customers.map((customer) => ({
    value: customerKey(customer),
    label: customer.customerName ?? "Cliente não informado",
    hint: `${customer.ofCount} ${customer.ofCount === 1 ? "OF" : "OFs"}`,
  }));
}

/** Opções do combobox de OFs do cliente escolhido (já filtradas no servidor). */
export function orderComboboxOptions(ofs: readonly RomaneioCandidate[]): ComboboxOption[] {
  return ofs.map((of) => ({
    value: of.orderId,
    label: of.code,
    hint: of.deliveryDate ? `Entrega ${formatDate(of.deliveryDate)}` : "Sem data de entrega",
    badge: of.hasOpenRomaneio ? "Romaneio aberto" : undefined,
  }));
}

/**
 * Gate do botão de listar itens (ou abrir o romaneio já existente):
 * cliente + OF + data de saída. A OF com romaneio em montagem
 * dispensa a data — o rascunho aberto já tem a data vigente.
 */
export function canGenerateRomaneio(
  of: RomaneioCandidate | null,
  shipmentDate: string,
): boolean {
  if (!of) return false;
  if (of.hasOpenRomaneio) return true;
  return isValidISODate(shipmentDate);
}

/** Lê um texto de input ("2,5" / "2.5" / "") como quantidade. */
function parseQuantity(text: string | undefined): number {
  const quantity = Number.parseFloat((text ?? "").replace(",", "."));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

/**
 * Itens marcados nesta remessa (quantidade > 0), no formato do
 * `createRomaneioAction` — os demais ficam de fora da carga.
 */
export function markedRomaneioItems(
  items: readonly RomaneioOrderItem[],
  quantities: Record<string, string>,
): { orderItemId: string; quantity: number }[] {
  return items.flatMap((item) => {
    const quantity = parseQuantity(quantities[item.orderItemId]);
    return quantity > 0 ? [{ orderItemId: item.orderItemId, quantity }] : [];
  });
}

/** Pelo menos um item marcado com quantidade válida. */
export function canConfirmRomaneio(
  items: readonly RomaneioOrderItem[],
  quantities: Record<string, string>,
): boolean {
  return markedRomaneioItems(items, quantities).length > 0;
}

interface RomaneioNewFormProps {
  customers: RomaneioCustomerOption[];
}

/**
 * /romaneio/novo: seletor em cascata (cliente → OFs do cliente) + data de
 * saída obrigatória. "Listar itens" carrega os itens raiz da OF e "Confirmar
 * romaneio" cria o romaneio em MONTADO já com as quantidades desta remessa;
 * a OF com romaneio aberto leva direto ao rascunho existente.
 */
export function RomaneioNewForm({ customers }: RomaneioNewFormProps) {
  const router = useRouter();

  const [customerValue, setCustomerValue] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [shipmentDate, setShipmentDate] = useState("");
  const [items, setItems] = useState<RomaneioOrderItem[] | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const listEnabled = canGenerateRomaneio(selectedOf, shipmentDate);
  const openingExisting = Boolean(selectedOf?.hasOpenRomaneio && selectedOf.openRomaneioId);

  const onCustomerChange = (next: string) => {
    // Troca de cliente zera a OF escolhida e a lista de itens (cascata).
    setCustomerValue(next);
    setOrderId(null);
    setItems(null);
    setQuantities({});
  };

  const onOrderChange = (next: string) => {
    setOrderId(next);
    setItems(null);
    setQuantities({});
  };

  const handleListItems = async () => {
    if (loadingItems || !selectedOf || !listEnabled) return;

    setLoadingItems(true);
    try {
      const result = await getRomaneioOrderItemsAction(selectedOf.orderId);
      if (!result.success || result.items.length === 0) {
        toast.error(result.message || "Não foi possível carregar os itens da OF.");
        return;
      }
      setItems(result.items);
      setQuantities({});
    } catch (error) {
      console.error("[RomaneioNewForm]", error);
      toast.error(errorMessage(error));
    } finally {
      setLoadingItems(false);
    }
  };

  const handleCreate = async () => {
    if (creating || !selectedOf || !items || !isValidISODate(shipmentDate)) return;

    const marked = markedRomaneioItems(items, quantities);
    if (marked.length === 0) {
      toast.error("Informe a quantidade de pelo menos um item nesta remessa.");
      return;
    }

    setCreating(true);
    try {
      const result = await createRomaneioAction({
        orderId: selectedOf.orderId,
        shipmentDate,
        items: marked,
      });
      if (!result.success || !result.romaneioId) {
        toast.error(result.message || "Não foi possível criar o romaneio.");
        return;
      }
      toast.success(result.message);
      router.push(`/romaneio/${result.romaneioId}`);
    } catch (error) {
      console.error("[RomaneioNewForm]", error);
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section aria-label="Gerar romaneio" className="space-y-3">
      <div className="rounded border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-1">
            <Label htmlFor="romaneio-novo-cliente" className="text-xs text-muted-foreground">
              Cliente
            </Label>
            <Combobox
              id="romaneio-novo-cliente"
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
            <Label htmlFor="romaneio-novo-of" className="text-xs text-muted-foreground">
              OF
            </Label>
            <Combobox
              id="romaneio-novo-of"
              label="OF"
              placeholder={customer ? "Selecione a OF…" : "Escolha primeiro o cliente…"}
              options={orderOptions}
              value={orderId}
              onChange={onOrderChange}
              disabled={!customer}
              emptyMessage="Nenhuma OF disponível para este cliente."
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="romaneio-novo-saida" className="text-xs text-muted-foreground">
              Data de saída
            </Label>
            <Input
              id="romaneio-novo-saida"
              type="date"
              value={shipmentDate}
              onChange={(event) => setShipmentDate(event.target.value)}
              disabled={openingExisting}
              className="w-full xl:w-44"
              aria-describedby="romaneio-novo-saida-ajuda"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p id="romaneio-novo-saida-ajuda">
              {openingExisting
                ? "Esta OF já tem um romaneio em montagem — o botão abre o rascunho existente."
                : "Liste os itens da OF e marque as quantidades desta remessa."}
            </p>
            {selectedOf ? (
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="px-1 py-0">
                  {selectedOf.type}
                </Badge>
                <span className="font-medium text-foreground tabular-nums">{selectedOf.code}</span>
                <OrderStatusBadge status={selectedOf.status} />
                <span className="tabular-nums">
                  {formatQuantity(selectedOf.rootQuantity)} un · {formatWeight(selectedOf.rootWeightKg)}
                </span>
                <span className="tabular-nums">
                  Já expedida: {formatQuantity(selectedOf.shippedQuantity)}
                </span>
                {selectedOf.hasOpenRomaneio ? (
                  <Badge variant="warning" className="normal-case">
                    Romaneio aberto
                  </Badge>
                ) : null}
              </p>
            ) : (
              <p>Selecione o cliente e a OF — um romaneio em montagem por OF.</p>
            )}
          </div>

          {openingExisting && selectedOf?.openRomaneioId ? (
            <Button
              type="button"
              id="romaneio-novo-abrir"
              onClick={() => router.push(`/romaneio/${selectedOf.openRomaneioId}`)}
              aria-describedby="romaneio-novo-saida-ajuda"
            >
              <ClipboardList className="h-4 w-4" aria-hidden />
              Abrir romaneio existente
            </Button>
          ) : !items ? (
            <Button
              type="button"
              id="romaneio-novo-listar"
              disabled={!listEnabled || loadingItems}
              onClick={handleListItems}
              aria-describedby="romaneio-novo-saida-ajuda"
            >
              {loadingItems ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ClipboardList className="h-4 w-4" aria-hidden />
              )}
              Listar itens
            </Button>
          ) : (
            <Button
              type="button"
              id="romaneio-novo-confirmar"
              disabled={creating || !canConfirmRomaneio(items, quantities)}
              onClick={handleCreate}
              aria-describedby="romaneio-novo-saida-ajuda"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              Confirmar romaneio
            </Button>
          )}
        </div>
      </div>

      {items ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Itens desta remessa</h2>
            <p className="text-xs text-muted-foreground">
              Deixe a quantidade vazia (ou 0) nos itens que não saem nesta carga.
            </p>
          </div>
          <RomaneioItemsEditor
            items={items}
            canEdit
            quantities={quantities}
            onQuantityChange={(orderItemId, value) =>
              setQuantities((previous) => ({ ...previous, [orderItemId]: value }))
            }
          />
        </div>
      ) : null}
    </section>
  );
}
