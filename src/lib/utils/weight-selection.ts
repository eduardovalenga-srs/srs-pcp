import { isWeightGranularity, type WeightGranularity } from "@/lib/constants/production";
import { isValidISODate, todayISODate } from "@/lib/utils/dates";

/**
 * Filtros do painel "Peso concluído por processo" (074/079).
 *
 * A validação vive num único lugar porque a action do dashboard e a
 * exportação .xlsx precisam recortar EXATAMENTE a mesma lista — qualquer
 * divergência faria a planilha sair diferente da tela.
 */
export interface WeightSelection {
  granularity: WeightGranularity;
  anchor: string;
  /** Código do processo; null = todos. */
  processCode: string | null;
  /** Família selecionada; null = todas ou "sem família", conforme a flag. */
  productGroupId: number | null;
  withoutProductGroup: boolean;
}

export interface WeightSelectionInput {
  granularity?: string | null;
  anchor?: string | null;
  processCode?: string | null;
  productGroupId?: number | string | null;
  withoutProductGroup?: boolean | string | null;
  /** Data usada quando a âncora vier vazia/inválida (default: hoje). */
  fallbackAnchor?: string;
}

export type WeightSelectionResult =
  | { success: true; selection: WeightSelection }
  | { success: false; message: string };

export function parseWeightSelection(input: WeightSelectionInput): WeightSelectionResult {
  const granularity = input.granularity?.trim() ?? "";
  if (!isWeightGranularity(granularity)) {
    return { success: false, message: "Período inválido." };
  }

  const rawAnchor = input.anchor?.trim() ?? "";
  const fallback = input.fallbackAnchor ?? todayISODate();
  const anchor = isValidISODate(rawAnchor) ? rawAnchor : fallback;

  const rawCode = input.processCode?.trim() ?? "";
  if (rawCode.length > 60 || /[\u0000-\u001f]/.test(rawCode)) {
    return { success: false, message: "Processo inválido." };
  }
  const processCode = rawCode === "" || rawCode === "ALL" ? null : rawCode;

  let productGroupId: number | null = null;
  const rawGroup =
    input.productGroupId === null || input.productGroupId === undefined
      ? ""
      : String(input.productGroupId).trim();
  if (rawGroup !== "") {
    const parsedGroup = Number(rawGroup);
    if (!Number.isInteger(parsedGroup) || parsedGroup <= 0) {
      return { success: false, message: "Família inválida." };
    }
    productGroupId = parsedGroup;
  }

  // "Sem família" só vale quando nenhum grupo específico foi escolhido.
  const withoutProductGroup =
    productGroupId === null &&
    (input.withoutProductGroup === true || input.withoutProductGroup === "true");

  return {
    success: true,
    selection: { granularity, anchor, processCode, productGroupId, withoutProductGroup },
  };
}
