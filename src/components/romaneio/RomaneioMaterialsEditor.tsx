"use client";

import type { RomaneioOfMaterialTotals } from "@/lib/types/romaneio";
import { formatQuantity, formatWeight, parseQuantity } from "@/lib/utils/formatting";
import { weightKgOf } from "@/lib/utils/romaneio";
import { MATERIAL_UNIT_LABELS, type MaterialUnit } from "@/lib/constants/materials";

/** Linha de material no estado do formulário (received/used como texto). */
export interface MaterialLineState {
  description: string;
  unit: string;
  quantityPlanned: number;
  received: string;
  /** Derivada dos itens da carga — exibida, nunca digitada aqui. */
  used: string;
}

interface RomaneioMaterialsEditorProps {
  materials: MaterialLineState[];
  /** Σ da OF inteira entre romaneios não cancelados (nota abaixo). */
  ofTotals: RomaneioOfMaterialTotals;
  /**
   * Peso total da carga (kg) — MESMA fonte do cabeçalho (Σ da
   * utilizada em unidade de peso, com fallback no peso dos itens);
   * null = sem peso ("—"). Recalculado ao vivo no detalhe.
   */
  weightKg: number | null;
}

function unitLabel(unit: string): string {
  return MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
}

/** Quantidade de colunas da tabela de materiais. */
const COLUMN_COUNT = 3;

/**
 * Devolução de matéria-prima (somente leitura no detalhe): a lista
 * traz, por material, a UNIDADE e o PESO INDIVIDUAL — a UTILIZADA em
 * unidade de peso (KG vale, G ÷ 1000; em UN/M/CX… não há peso e a
 * célula sai "—"), exatamente como aparecia na antiga coluna
 * "Utilizada na produção": derivado da alocação da OF, alinhado à
 * direita e recalculado AO VIVO a cada tecla nas quantidades dos itens.
 * O saldo a devolver saiu da lista (a coluna anterior quase sempre
 * zerada); ele continua agregado na nota da OF inteira e por romaneio
 * na listagem /romaneio.
 *
 * O pé da tabela fecha com UMA única linha — o PESO TOTAL DA CARGA
 * (Σ da utilizada em KG, a mesma fonte do cabeçalho, da ficha e da
 * exportação). O lançamento continua sendo só na ficha de conferência.
 */
export function RomaneioMaterialsEditor({
  materials,
  ofTotals,
  weightKg,
}: RomaneioMaterialsEditorProps) {
  /** Peso individual da linha (kg) — a utilizada já convertida. */
  const lineWeightKg = (line: MaterialLineState): number | null => {
    const used = parseQuantity(line.used);
    if (used === null) return null;
    return weightKgOf(line.unit, used);
  };

  /** Peso individual na TABELA — a coluna já carrega o "(kg)". */
  const renderLineWeight = (line: MaterialLineState) => {
    const kg = lineWeightKg(line);
    return kg === null ? "—" : formatWeight(kg);
  };

  /** Peso individual nos cards mobile — com a unidade escrita. */
  const weightText = (line: MaterialLineState) => {
    const kg = lineWeightKg(line);
    return kg === null ? "—" : `${formatWeight(kg)} kg`;
  };

  const hasWeight = weightKg !== null;

  return (
    <div className="space-y-3">
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Matérias-primas para devolução, com a unidade e o peso individual de cada uma — e o
            peso total da carga ao pé.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">Material</th>
              <th scope="col" className="px-3 py-2 font-semibold">Unidade</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Peso (kg)</th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum material alocado para os itens desta carga — inclua itens com
                  matéria-prima para ver a devolução.
                </td>
              </tr>
            ) : (
              materials.map((line) => (
                <tr key={`${line.description}::${line.unit}`} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="max-w-[280px] px-3 py-2">
                    <span className="block truncate" title={line.description}>
                      {line.description}
                    </span>
                  </td>
                  <td className="px-3 py-2">{unitLabel(line.unit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{renderLineWeight(line)}</td>
                </tr>
              ))
            )}

            {/* ÚNICA linha ao pé: o peso total da carga (mesmo número do
                cabeçalho, da tabela de itens e da exportação). */}
            {materials.length > 0 ? (
              <tr className="border-t bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <td className="px-3 py-2 font-semibold" colSpan={2}>
                  Peso total da carga
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                  {hasWeight ? `${formatWeight(weightKg)} kg` : "—"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {materials.map((line) => (
          <li key={`${line.description}::${line.unit}`} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium">{line.description}</p>
              <span className="text-xs text-muted-foreground">{unitLabel(line.unit)}</span>
            </header>

            <p className="mt-2 text-right text-sm tabular-nums">
              <span className="text-xs text-muted-foreground">Peso: </span>
              {weightText(line)}
            </p>
          </li>
        ))}
        {materials.length === 0 ? (
          <li className="rounded border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum material alocado para os itens desta carga.
          </li>
        ) : null}
      </ul>

      {/* Peso total — ÚNICA linha de total no mobile (a de "Total da
          carga" saiu: saldo somado, quase sempre zerada). */}
      {materials.length > 0 ? (
        <p className="flex items-center justify-between gap-2 rounded border bg-card px-3 py-2 text-sm lg:hidden">
          <span className="font-medium">Peso total da carga</span>
          <span className="tabular-nums">
            {hasWeight ? `${formatWeight(weightKg)} kg` : "—"}
          </span>
        </p>
      ) : null}

      <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">OF inteira (todos os romaneios):</span>{" "}
          recebida {formatQuantity(ofTotals.received)} · utilizada {formatQuantity(ofTotals.used)} ·
          saldo a devolver {formatQuantity(ofTotals.returned)}
        </p>
        <p className="mt-1">
          O peso da linha é a utilizada já em kg (KG vale, G ÷ 1000) — derivado da alocação desta
          carga e recalculado ao alterar as quantidades dos itens; linhas em outras unidades (UN,
          M, CX…) não têm peso e saem “—”. O que se informa é a recebida, na ficha de
          conferência (é dela que nasce o saldo a devolver). Linhas sem NF de devolução ficam
          marcadas na listagem.
        </p>
      </div>
    </div>
  );
}
