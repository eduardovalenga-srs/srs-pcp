"use client";

import type { RomaneioOrderItem } from "@/lib/types/romaneio";
import type { ProcessDefinition } from "@/lib/types/production";
import { romaneioProcessColumns } from "@/lib/constants/processes";
import {
  PROCESS_STATUS_LABELS,
  PROCESS_STATUS_SYMBOLS,
  type ProcessStatus,
} from "@/lib/constants/production";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Input } from "@/components/ui/input";

interface RomaneioItemsEditorProps {
  /**
   * Itens efetivos do detalhe — `quantity` JÁ vem interpretada do
   * texto digitado (mesmo parser do salvamento: vazio/inválido = 0),
   * então os pesos e alertas acompanham a digitação na hora.
   */
  items: RomaneioOrderItem[];
  /**
   * Catálogo ativo de processos (049) — vira UMA coluna por processo da
   * Fábrica 2 (catálogo menos a cadeia F1, MP e KIT), na ordem do
   * catálogo: as colunas de processo da carga moram AQUI, no detalhe.
   */
  processes: ProcessDefinition[];
  canEdit: boolean;
  /**
   * Peso total da carga (kg) — mesma fonte do cabeçalho (Σ da
   * utilizada em unidade de peso, fallback nos itens); null = sem peso
   * (a linha do rodapé nem aparece). Recalculado ao vivo no detalhe.
   */
  weightKg: number | null;
  /** Texto digitado: orderItemId -> valor do input ("", "10", "2,5"). */
  quantities: Record<string, string>;
  onQuantityChange: (orderItemId: string, value: string) => void;
}

/**
 * Célula de processo (049): só o símbolo da situação (colunas estreitas);
 * chave ausente no mapa do item = o item não tem linha daquele processo → "—".
 */
function ProcessSymbolCell({
  process,
  status,
}: {
  process: ProcessDefinition;
  status: ProcessStatus | undefined;
}) {
  const title = `${process.name}: ${
    status ? PROCESS_STATUS_LABELS[status] : "não aplicável a este item"
  }`;
  return (
    <span role="img" aria-label={title} title={title}>
      {status ? PROCESS_STATUS_SYMBOLS[status] : "—"}
    </span>
  );
}

/**
 * Editor de itens do romaneio — só itens RAIZ da OF (o EXP mora no pai).
 * "0"/vazio = item fora desta carga; a pendência ao lado lembra o teto da
 * expedição parcial (qtd do item − já emitida em outros romaneios).
 * Cada coluna de processo mostra a situação DAQUELE item (mesma regra de
 * colunas da antiga lista, agora por item em vez de agregada por carga).
 */
export function RomaneioItemsEditor({
  items,
  processes,
  canEdit,
  weightKg,
  quantities,
  onQuantityChange,
}: RomaneioItemsEditorProps) {
  // 049: colunas de processo = regra da tela Fábrica 2 (catálogo ativo
  // menos a cadeia F1) menos MP e KIT, na ordem do catálogo.
  const processColumns = romaneioProcessColumns(processes);
  // Totalizador da coluna "Peso carga (kg)" — o MESMO número do
  // cabeçalho e da tabela de materiais (Σ da utilizada em KG/G; sem
  // material em peso, volta ao qtd × peso unitário dos itens).
  const hasAnyWeight = weightKg !== null;
  const weightTotal = weightKg;
  // Colunas antes do "Peso carga (kg)" — base do colSpan do rodapé.
  const leadingColumns = 3 + processColumns.length + 4;

  return (
    <>
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Itens raiz da OF com situação da expedição, situação de cada processo da carga,
            quantidades e pesos.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">Família</th>
              <th scope="col" className="px-3 py-2 font-semibold">Item pai</th>
              <th scope="col" className="px-3 py-2 font-semibold">Descrição</th>
              {/* 049: uma coluna por processo da Fábrica 2 — só o símbolo. */}
              {processColumns.map((process) => (
                <th key={process.code} scope="col" className="px-3 py-2 text-center font-semibold">
                  <span className="block truncate" title={process.name}>
                    <span aria-hidden>{process.code}</span>
                    <span className="sr-only">{process.name}</span>
                  </span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-semibold">Qtd OF</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Já expedida</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Pendência</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Nesta carga</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Peso carga (kg)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const quantityText = quantities[item.orderItemId] ?? "";
              const quantity = item.quantity;
              const pending = Math.max(item.itemQuantity - item.shippedQuantity, 0);
              const overLimit = quantity + item.shippedQuantity > item.itemQuantity;
              return (
                <tr key={item.orderItemId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">{item.family || "—"}</td>
                  <td className="px-3 py-2">{item.parentItem || "—"}</td>
                  <td className="max-w-[260px] px-3 py-2">
                    <span className="block truncate" title={item.description}>
                      {item.description || "—"}
                    </span>
                  </td>
                  {processColumns.map((process) => (
                    <td key={process.code} className="px-3 py-2 text-center">
                      <ProcessSymbolCell
                        process={process}
                        status={item.processes[process.code]}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(item.itemQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(item.shippedQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(pending)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${item.description} nesta carga`}
                        value={quantityText}
                        disabled={!canEdit}
                        onChange={(event) => onQuantityChange(item.orderItemId, event.target.value)}
                        placeholder="0"
                        className={`h-8 w-24 text-right tabular-nums${overLimit ? " border-destructive" : ""}`}
                      />
                    </div>
                    {overLimit ? (
                      <p className="mt-1 text-right text-xs text-destructive">
                        Acima da pendência
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.loadWeightKg === null ? "—" : formatWeight(item.loadWeightKg)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {hasAnyWeight ? (
            <tfoot>
              <tr className="border-t bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <td className="px-3 py-2 font-semibold" colSpan={leadingColumns}>
                  Peso total da carga
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                  {formatWeight(weightTotal)} kg
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {items.map((item) => {
          const quantityText = quantities[item.orderItemId] ?? "";
          const quantity = Number.parseFloat(quantityText.replace(",", ".")) || 0;
          const pending = Math.max(item.itemQuantity - item.shippedQuantity, 0);
          const overLimit = quantity + item.shippedQuantity > item.itemQuantity;
          return (
            <li key={item.orderItemId} className="rounded border bg-card p-3">
              <p className="text-sm font-medium">{item.description || "—"}</p>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {[item.family, item.parentItem].filter(Boolean).join(" · ") || "Sem família"}
              </p>

              {/* 049: processos do item — mesma linha compacta de símbolos
                  nas colunas da tabela do desktop. */}
              <ul
                aria-label="Processos do item"
                className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
              >
                {processColumns.map((process) => {
                  const status = item.processes[process.code];
                  const label = status
                    ? PROCESS_STATUS_LABELS[status]
                    : "não aplicável a este item";
                  return (
                    <li key={process.code} className="inline-flex items-center gap-1">
                      <span aria-hidden>{status ? PROCESS_STATUS_SYMBOLS[status] : "—"}</span>
                      <span>{process.code}</span>
                      <span className="sr-only">
                        {process.name}: {label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Qtd OF</dt>
                  <dd className="tabular-nums">{formatQuantity(item.itemQuantity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Já expedida</dt>
                  <dd className="tabular-nums">{formatQuantity(item.shippedQuantity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Pendência</dt>
                  <dd className="tabular-nums">{formatQuantity(pending)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor={`item-${item.orderItemId}`}
                    className="text-xs text-muted-foreground"
                  >
                    Nesta carga
                  </label>
                  <Input
                    id={`item-${item.orderItemId}`}
                    type="text"
                    inputMode="decimal"
                    value={quantityText}
                    disabled={!canEdit}
                    onChange={(event) => onQuantityChange(item.orderItemId, event.target.value)}
                    placeholder="0"
                    className={`h-8 w-24 text-right tabular-nums${overLimit ? " border-destructive" : ""}`}
                  />
                </div>
                <p className="text-sm tabular-nums text-muted-foreground">
                  Peso: {item.loadWeightKg === null ? "—" : `${formatWeight(item.loadWeightKg)} kg`}
                </p>
              </div>
              {overLimit ? (
                <p className="mt-1 text-right text-xs text-destructive">Acima da pendência</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
