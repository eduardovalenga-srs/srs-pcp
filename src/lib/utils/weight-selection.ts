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
  /** Famílias selecionadas; lista vazia = todas. */
  productGroupIds: number[];
  /** Inclui OFs sem família junto às famílias selecionadas. */
  withoutProductGroup: boolean;
}

export interface WeightSelectionInput {
  granularity?: string | null;
  anchor?: string | null;
  processCode?: string | null;
  productGroupIds?: readonly (number | string)[] | string | null;
  /** Compatibilidade com consumidores antigos de seleção única. */
  productGroupId?: number | string | null;
  families?: string | null;
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

  const rawGroups =
    input.productGroupIds ??
    input.families ??
    (input.productGroupId === null || input.productGroupId === undefined ? [] : [input.productGroupId]);
  const groupValues = typeof rawGroups === "string" ? rawGroups.split(",") : rawGroups;
  const productGroupIds = new Set<number>();
  let withoutProductGroup =
    input.withoutProductGroup === true || input.withoutProductGroup === "true";

  for (const value of groupValues) {
    const rawGroup = String(value).trim();
    if (!rawGroup) continue;
    if (rawGroup === "sem-familia") {
      withoutProductGroup = true;
      continue;
    }
    const parsedGroup = Number(rawGroup);
    if (!Number.isInteger(parsedGroup) || parsedGroup <= 0) {
      return { success: false, message: "Família inválida." };
    }
    productGroupIds.add(parsedGroup);
  }

  return {
    success: true,
    selection: {
      granularity,
      anchor,
      processCode,
      productGroupIds: [...productGroupIds],
      withoutProductGroup,
    },
  };
}
