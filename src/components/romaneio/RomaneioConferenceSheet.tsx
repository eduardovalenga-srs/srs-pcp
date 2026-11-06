"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";

import { saveRomaneioConferenceAction } from "@/lib/actions/romaneio.actions";
import { MATERIAL_UNIT_LABELS, type MaterialUnit } from "@/lib/constants/materials";
import type { RomaneioView } from "@/lib/types/romaneio";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { loadWeightKg, weightKgOf } from "@/lib/utils/romaneio";
import { errorMessage } from "@/lib/utils/supabase-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RomaneioStatusBadge } from "@/components/romaneio/RomaneioStatusBadge";

interface RomaneioConferenceSheetProps {
  view: RomaneioView;
  /** O perfil edita romaneios (capacidade romaneio.edit) — gate do formulário. */
  canEdit: boolean;
}

/** Rótulo da unidade como no detalhe (KG vira "kg"). */
function unitLabel(unit: string): string {
  return MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
}

/** Chave estável de uma linha de material (única por romaneio). */
function materialKey(description: string, unit: string): string {
  return `${description}::${unit}`;
}

/** Texto do input: número salvo vira texto; null vira "" (caixa vazia). */
function amountText(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Folha de conferência do romaneio — FORMULÁRIO na tela e impressa
 * para o check da carga no caminhão: marcação por item, recebida dos
 * materiais (a UTILIZADA é derivada dos itens da carga — somente
 * leitura, nem sai como coluna) e observação. As listas espelham as
 * do detalhe (itens sem colunas de processo; devolução com o peso
 * individual e o total ao pé) — o que é exclusivo da ficha é o ✔ por
 * item, o campo RECEBIDA e a impressão. "Salvar rascunho" grava sem
 * mudar a situação; "Marcar como conferida" grava tudo e move para
 * CONFERIDO (exige todos os itens marcados). Imprimir em branco e
 * lançar depois também vale — no papel saem caixas vazias onde falta
 * valor. Depois de CONFERIDO a ficha vira somente leitura (048).
 */
export function RomaneioConferenceSheet({ view, canEdit }: RomaneioConferenceSheetProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<"draft" | "sign" | null>(null);
  const [notes, setNotes] = useState(view.conferenceNotes ?? "");
  const [checked, setChecked] = useState<Set<string>>(
    () =>
      new Set(
        view.items
          .filter((item) => item.quantity > 0 && item.conferenceChecked)
          .map((item) => item.orderItemId),
      ),
  );
  const [received, setReceivedState] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      view.materials.map((line) => [
        materialKey(line.description, line.unit),
        amountText(line.quantityReceived),
      ]),
    ),
  );

  const included = view.items.filter((item) => item.quantity > 0);
  const editable = canEdit && view.status === "ABERTO";
  const pendingCount = included.filter((item) => !checked.has(item.orderItemId)).length;
  // Peso da carga = Σ da "Utilizada" em unidade de peso (mesmo número
  // do detalhe); sem linha em KG/G, cai no peso dos itens.
  const weightTotal = loadWeightKg(view.materials, included);
  const hasAnyWeight = weightTotal !== null;

  const handlePrint = () => {
    window.print();
  };

  const toggleItem = (orderItemId: string) => {
    if (!editable) return;
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(orderItemId)) {
        next.delete(orderItemId);
      } else {
        next.add(orderItemId);
      }
      return next;
    });
  };

  const setReceived = (key: string, value: string) => {
    if (!editable) return;
    setReceivedState((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async (sign: boolean) => {
    if (busy) return;
    if (sign && pendingCount > 0) return;
    setBusy(sign ? "sign" : "draft");
    try {
      const result = await saveRomaneioConferenceAction({
        romaneioId: view.id,
        notes: notes.trim() || null,
        checkedItemIds: included
          .filter((item) => checked.has(item.orderItemId))
          .map((item) => item.orderItemId),
        materials: view.materials.map((line) => ({
          description: line.description,
          unit: line.unit,
          // Alocado do pedido — o upsert da 052 usa este valor quando a
          // linha ainda não existe em romaneio_materials.
          quantityPlanned: line.quantityPlanned,
          quantityReceived:
            (received[materialKey(line.description, line.unit)] ?? "").trim() === ""
              ? null
              : received[materialKey(line.description, line.unit)],
          // Derivada dos itens da carga (view.materials em ABERTO já
          // nasce da alocação) — a ficha só lança a recebida.
          quantityUsed: line.quantityUsed,
        })),
        sign,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      console.error("[RomaneioConferenceSheet]", error);
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* Barra de ações — fora do papel */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">
          {editable
            ? "Preencha a conferência na tela ou imprima a folha para conferir no papel e lançar depois."
            : "Folha de conferência — imprima para o registro em papel."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4" aria-hidden />
            Imprimir
          </Button>
          {editable ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleSave(false)}
                title="Grava marcação, materiais e observação sem mudar a situação"
              >
                {busy === "draft" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                Salvar rascunho
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy !== null || pendingCount > 0}
                onClick={() => void handleSave(true)}
                title={
                  pendingCount > 0
                    ? `Faltam ${pendingCount} item(ns) marcados`
                    : "Grava tudo e move o romaneio para Conferido"
                }
              >
                {busy === "sign" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                )}
                Marcar como conferida
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {editable && pendingCount > 0 ? (
        <p className="text-xs text-muted-foreground print:hidden">
          Faltam {pendingCount}{" "}
          {pendingCount === 1 ? "item marcado" : "itens marcados"} para concluir a conferência.
        </p>
      ) : null}

      {editable ? (
        <div className="space-y-1 rounded border bg-card p-3 print:hidden">
          <Label htmlFor="romaneio-conferencia-sheet-obs" className="text-xs text-muted-foreground">
            Observação do aceite (opcional)
          </Label>
          <Textarea
            id="romaneio-conferencia-sheet-obs"
            value={notes}
            maxLength={500}
            rows={2}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: carga conferida com o cliente, avarias inexistentes…"
          />
        </div>
      ) : null}

      {/* Folha de conferência */}
      <article className="space-y-4 rounded border bg-card p-4 sm:p-6 print:space-y-3 print:rounded-none print:border-0 print:bg-transparent print:p-0">
        <header className="space-y-1 border-b pb-3 print:border-black">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-lg font-semibold">
              Folha de conferência — Romaneio nº {view.number}
            </h1>
            <RomaneioStatusBadge status={view.status} className="print:hidden" />
          </div>
          <p className="text-sm text-muted-foreground">
            Confira os itens da carga e a devolução de matéria-prima. Marque cada linha conferida.
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">OF/OS</dt>
            <dd className="font-medium tabular-nums">{view.orderCode}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cliente</dt>
            <dd>{view.customerName || "Cliente não informado"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Data de saída</dt>
            <dd className="tabular-nums">{formatDate(view.shipmentDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Transportadora</dt>
            <dd>{view.carrier || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Veículo / placa</dt>
            <dd>{view.vehicle || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Peso da carga</dt>
            <dd className="tabular-nums">
              {hasAnyWeight ? `${formatWeight(weightTotal)} kg` : "—"}
            </dd>
          </div>
        </dl>

        {/* Itens da carga — espelho das colunas do detalhe (sem as
            colunas de processo, que moram só no detalhe). */}
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Itens da carga</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground print:border-black">
                  <th scope="col" className="w-8 py-1 pr-2 font-semibold">
                    ✔
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">Família</th>
                  <th scope="col" className="py-1 pr-2 font-semibold">Item pai</th>
                  <th scope="col" className="py-1 pr-2 font-semibold">Descrição</th>
                  <th scope="col" className="py-1 pr-2 text-right font-semibold">Qtd OF</th>
                  <th scope="col" className="py-1 pr-2 text-right font-semibold">Já expedida</th>
                  <th scope="col" className="py-1 pr-2 text-right font-semibold">Pendência</th>
                  <th scope="col" className="py-1 pr-2 text-right font-semibold">Nesta carga</th>
                  <th scope="col" className="py-1 text-right font-semibold">Peso carga (kg)</th>
                </tr>
              </thead>
              <tbody>
                {included.map((item) => {
                  const pending = Math.max(item.itemQuantity - item.shippedQuantity, 0);
                  return (
                    <tr
                      key={item.orderItemId}
                      className="border-b last:border-0 print:border-black/40"
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Marcar como conferido: ${item.description || item.orderItemId}`}
                          checked={checked.has(item.orderItemId)}
                          disabled={!editable}
                          onChange={() => toggleItem(item.orderItemId)}
                          className="h-4 w-4 print:hidden"
                        />
                        <span
                          aria-hidden
                          className="hidden h-4 w-4 border text-center text-[11px] leading-[14px] print:block"
                        >
                          {checked.has(item.orderItemId) ? "✔" : ""}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{item.family || "—"}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{item.parentItem || "—"}</td>
                      <td className="py-1.5 pr-2">{item.description || "—"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatQuantity(item.itemQuantity)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatQuantity(item.shippedQuantity)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatQuantity(pending)}
                      </td>
                      {/* Quantidade desta carga — na ficha é só leitura
                          (a edição mora no detalhe). */}
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatQuantity(item.quantity)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {item.loadWeightKg === null ? "—" : formatWeight(item.loadWeightKg)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Devolução de matéria-prima — espelho do detalhe (Material,
            Unidade, Peso (kg) e o total ao pé) + RECEBIDA, que é o
            único lançamento da ficha. */}
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Devolução de matéria-prima</h2>
          {view.materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum material registrado para devolução nesta carga.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground print:border-black">
                    <th scope="col" className="py-1 pr-2 font-semibold">Material</th>
                    <th scope="col" className="py-1 pr-2 font-semibold">Unidade</th>
                    <th scope="col" className="py-1 pr-2 text-right font-semibold">Peso (kg)</th>
                    <th scope="col" className="py-1 text-right font-semibold">Recebida</th>
                  </tr>
                </thead>
                <tbody>
                  {view.materials.map((line) => {
                    const key = materialKey(line.description, line.unit);
                    const receivedText = received[key] ?? "";
                    // Peso individual = a utilizada já em kg (mesma
                    // regra do detalhe); unidades sem peso saem "—".
                    const lineWeightKg = weightKgOf(line.unit, line.quantityUsed);
                    return (
                      <tr key={key} className="border-b last:border-0 print:border-black/40">
                        <td className="py-1.5 pr-2">{line.description}</td>
                        <td className="py-1.5 pr-2">{unitLabel(line.unit)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {lineWeightKg === null ? "—" : formatWeight(lineWeightKg)}
                        </td>
                        <td className="py-1.5 text-right">
                          <div className="flex justify-end">
                            <Input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Quantidade recebida de ${line.description}`}
                              value={receivedText}
                              readOnly={!editable}
                              onChange={(event) => setReceived(key, event.target.value)}
                              className="h-8 w-24 text-right tabular-nums"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* ÚNICA linha ao pé: o peso total da carga (mesmo
                      número do cabeçalho e do detalhe). */}
                  <tr className="border-t text-[11px] uppercase tracking-wide text-muted-foreground print:border-black">
                    <td className="py-1.5 pr-2 font-semibold" colSpan={2}>
                      Peso total da carga
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-foreground">
                      {hasAnyWeight ? `${formatWeight(weightTotal)} kg` : "—"}
                    </td>
                    <td aria-hidden />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Observações + aceite */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Observações</h2>
            <div className="mt-1 h-12 rounded border print:border-black" aria-hidden />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Conferido por (nome e assinatura)</p>
              <div className="mt-6 border-b print:border-black" aria-hidden />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Data do aceite</p>
              <div className="mt-6 border-b print:border-black" aria-hidden />
            </div>
          </div>

          {view.conferenceAcceptedAt ? (
            <p className="text-xs text-muted-foreground">
              Aceite registrado no sistema em {formatDateTime(view.conferenceAcceptedAt)}
              {view.conferenceAcceptedByName ? ` por ${view.conferenceAcceptedByName}` : ""}
              {view.conferenceNotes ? ` — Obs.: ${view.conferenceNotes}` : ""}.
            </p>
          ) : null}
        </section>
      </article>
    </div>
  );
}
