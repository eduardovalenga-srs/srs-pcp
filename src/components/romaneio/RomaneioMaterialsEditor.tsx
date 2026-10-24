"use client";

import type { RomaneioOfMaterialTotals } from "@/lib/types/romaneio";
import { formatQuantity } from "@/lib/utils/formatting";
import { MATERIAL_UNIT_LABELS, type MaterialUnit } from "@/lib/constants/materials";
import { Input } from "@/components/ui/input";

/** Linha de material no estado do formulário (received/used como texto). */
export interface MaterialLineState {
  description: string;
  unit: string;
  quantityPlanned: number;
  received: string;
  used: string;
}

interface RomaneioMaterialsEditorProps {
  materials: MaterialLineState[];
  canEdit: boolean;
  /** Σ da OF inteira entre romaneios não cancelados. */
  ofTotals: RomaneioOfMaterialTotals;
  onFieldChange: (index: number, field: "received" | "used", value: string) => void;
}

function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return null;
  if (!/^\d*\.?\d+$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitLabel(unit: string): string {
  return MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
}

/**
 * Editor de devolução de matéria-prima: o PREVISTO vem alocado da OF
 * (recalculado no salvamento) e o usuário informa RECEBIDA do cliente e
 * UTILIZADA na produção — o saldo (recebida − utilizada) aparece na hora.
 * O Σ ao pé mostra a visão da OF inteira entre romaneios.
 */
export function RomaneioMaterialsEditor({
  materials,
  canEdit,
  ofTotals,
  onFieldChange,
}: RomaneioMaterialsEditorProps) {
  const renderSaldo = (line: MaterialLineState) => {
    const received = parseAmount(line.received);
    const used = parseAmount(line.used);
    if (received === null || used === null) return "—";
    const balance = received - used;
    return (
      <span className={balance > 0 ? "font-medium text-status-progress" : "tabular-nums"}>
        {formatQuantity(balance)}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Matérias-primas para devolução, com quantidades prevista, recebida, utilizada e saldo.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">Material</th>
              <th scope="col" className="px-3 py-2 font-semibold">Unidade</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Previsto (carga)</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Recebida do cliente</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Utilizada na produção</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Saldo a devolver</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((line, index) => (
              <tr key={`${line.description}::${line.unit}`} className="border-b last:border-0 hover:bg-muted/30">
                <td className="max-w-[280px] px-3 py-2">
                  <span className="block truncate" title={line.description}>
                    {line.description}
                  </span>
                </td>
                <td className="px-3 py-2">{unitLabel(line.unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatQuantity(line.quantityPlanned)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end">
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Quantidade recebida de ${line.description}`}
                      value={line.received}
                      disabled={!canEdit}
                      onChange={(event) => onFieldChange(index, "received", event.target.value)}
                      className="h-8 w-28 text-right tabular-nums"
                    />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end">
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Quantidade utilizada de ${line.description}`}
                      value={line.used}
                      disabled={!canEdit}
                      onChange={(event) => onFieldChange(index, "used", event.target.value)}
                      className="h-8 w-28 text-right tabular-nums"
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{renderSaldo(line)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <td className="px-3 py-2 font-semibold" colSpan={2}>
                OF inteira (todos os romaneios)
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                {formatQuantity(ofTotals.received)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                {formatQuantity(ofTotals.used)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                {formatQuantity(ofTotals.returned)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {materials.map((line, index) => (
          <li key={`${line.description}::${line.unit}`} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium">{line.description}</p>
              <span className="text-xs text-muted-foreground">{unitLabel(line.unit)}</span>
            </header>

            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              Previsto nesta carga: {formatQuantity(line.quantityPlanned)}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor={`material-recebida-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  Recebida do cliente
                </label>
                <Input
                  id={`material-recebida-${index}`}
                  type="text"
                  inputMode="decimal"
                  value={line.received}
                  disabled={!canEdit}
                  onChange={(event) => onFieldChange(index, "received", event.target.value)}
                  className="h-8 text-right tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`material-utilizada-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  Utilizada na produção
                </label>
                <Input
                  id={`material-utilizada-${index}`}
                  type="text"
                  inputMode="decimal"
                  value={line.used}
                  disabled={!canEdit}
                  onChange={(event) => onFieldChange(index, "used", event.target.value)}
                  className="h-8 text-right tabular-nums"
                />
              </div>
            </div>

            <p className="mt-2 text-right text-sm">
              <span className="text-xs text-muted-foreground">Saldo a devolver: </span>
              {renderSaldo(line)}
            </p>
          </li>
        ))}
      </ul>

      <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">OF inteira (todos os romaneios):</span>{" "}
          recebida {formatQuantity(ofTotals.received)} · utilizada {formatQuantity(ofTotals.used)} ·
          saldo a devolver {formatQuantity(ofTotals.returned)}
        </p>
        <p className="mt-1">
          O previsto é a alocação proporcional desta carga — salve para recalculá-lo ao alterar as
          quantidades dos itens. Linhas sem NF de devolução ficam marcadas na listagem.
        </p>
      </div>
    </div>
  );
}
