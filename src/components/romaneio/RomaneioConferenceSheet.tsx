"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { signRomaneioConferenceAction } from "@/lib/actions/romaneio.actions";
import type { RomaneioView } from "@/lib/types/romaneio";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { errorMessage } from "@/lib/utils/supabase-result";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RomaneioStatusBadge } from "@/components/romaneio/RomaneioStatusBadge";

interface RomaneioConferenceSheetProps {
  view: RomaneioView;
  /** O perfil edita romaneios (capacidade romaneio.edit) — gate do aceite. */
  canSign: boolean;
}

/**
 * Folha de conferência do romaneio — versão IMPRIMÍVEL para o check da
 * carga no caminhão: mostra SÓ os itens selecionados (com quadrinho para
 * conferir a mão) e a lista de devolução de matéria-prima. "Sinalizar
 * aceite" registra quem/quando e move o romaneio para CONFERIDO.
 */
export function RomaneioConferenceSheet({ view, canSign }: RomaneioConferenceSheetProps) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");

  const included = view.items.filter((item) => item.quantity > 0);
  const weightTotal = included.reduce(
    (sum, item) => sum + (item.unitWeightKg === null ? 0 : item.unitWeightKg * item.quantity),
    0,
  );
  const hasAnyWeight = included.some((item) => item.unitWeightKg !== null);
  const signAllowed = canSign && (view.status === "MONTADO" || view.status === "CONFERIDO");

  const handlePrint = () => {
    window.print();
  };

  const handleSign = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await signRomaneioConferenceAction(view.id, notes.trim() || null);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setNotes("");
      router.refresh();
    } catch (error) {
      console.error("[RomaneioConferenceSheet]", error);
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* Barra de ações — fora do papel */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">
          Imprima a folha e confira a carga antes de sinalizar o aceite.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4" aria-hidden />
            Imprimir
          </Button>
          {signAllowed ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void handleSign()}
              title={
                view.status === "CONFERIDO"
                  ? "Atualiza o registro do aceite (romaneio já conferido)"
                  : "Registra o aceite e move o romaneio para Conferido"
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ClipboardCheck className="h-4 w-4" aria-hidden />
              )}
              Sinalizar aceite
            </Button>
          ) : null}
        </div>
      </div>

      {signAllowed ? (
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

        {/* Itens da carga */}
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Itens da carga</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground print:border-black">
                  <th scope="col" className="w-8 py-1 pr-2 font-semibold">
                    ✔
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">Descrição</th>
                  <th scope="col" className="py-1 pr-2 font-semibold">Família / item pai</th>
                  <th scope="col" className="py-1 pr-2 text-right font-semibold">Qtd</th>
                  <th scope="col" className="py-1 text-right font-semibold">Peso (kg)</th>
                </tr>
              </thead>
              <tbody>
                {included.map((item) => (
                  <tr key={item.orderItemId} className="border-b last:border-0 print:border-black/40">
                    <td className="py-1.5 pr-2">
                      <span
                        className="inline-block h-4 w-4 border print:border-black"
                        aria-hidden
                      />
                    </td>
                    <td className="py-1.5 pr-2">{item.description || "—"}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">
                      {[item.family, item.parentItem].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatQuantity(item.quantity)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {item.unitWeightKg === null ? "—" : formatWeight(item.unitWeightKg * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Devolução de matéria-prima */}
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
                    <th scope="col" className="w-8 py-1 pr-2 font-semibold">
                      ✔
                    </th>
                    <th scope="col" className="py-1 pr-2 font-semibold">Material</th>
                    <th scope="col" className="py-1 pr-2 font-semibold">Un.</th>
                    <th scope="col" className="py-1 pr-2 text-right font-semibold">Previsto</th>
                    <th scope="col" className="py-1 text-right font-semibold">Conferido</th>
                  </tr>
                </thead>
                <tbody>
                  {view.materials.map((line) => (
                    <tr
                      key={`${line.description}-${line.unit}`}
                      className="border-b last:border-0 print:border-black/40"
                    >
                      <td className="py-1.5 pr-2">
                        <span
                          className="inline-block h-4 w-4 border print:border-black"
                          aria-hidden
                        />
                      </td>
                      <td className="py-1.5 pr-2">{line.description}</td>
                      <td className="py-1.5 pr-2">{line.unit}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatQuantity(line.quantityPlanned)}
                      </td>
                      <td className="py-1.5 text-right">
                        <span className="inline-block w-16 border-b print:border-black" aria-hidden />
                      </td>
                    </tr>
                  ))}
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
