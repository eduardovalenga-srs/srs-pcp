/** Formatação de números, quantidades e pesos. */

/** Casas decimais de PESO (kg) em todo o sistema. */
export const WEIGHT_DECIMALS = 2;

/**
 * Arredonda um número para `decimals` casas (half-up).
 *
 * O epsilon corrige o erro binário do JavaScript em casos como
 * 1.005 * 100 = 100.49999999999999 — sem ele, o valor ficaria em 1.00
 * enquanto o Postgres (numeric) arredonda para 1.01.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Arredonda um peso (kg) para {@link WEIGHT_DECIMALS} casas. */
export function roundWeight(value: number): number {
  return roundTo(value, WEIGHT_DECIMALS);
}

/** `roundWeight` preservando null (campos opcionais de peso). */
export function roundWeightOrNull(value: number | null): number | null {
  return value === null ? null : roundWeight(value);
}

export function formatQuantity(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toLocaleString("pt-BR");
}

export function formatWeight(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return roundWeight(numeric).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: WEIGHT_DECIMALS,
  });
}

export function formatNumber(value: number | string | null | undefined, digits = 2): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return numeric.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Converte valor de planilha/Banco em número aceitável (aceita vírgula decimal). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let raw = String(value).trim().replace(/\s/g, "").replace(/kg$/i, "");
  if (!raw) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    // 1.234,56 ou 1,234.56
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    raw = raw.replace(",", ".");
  }

  if (!/^-?\d*\.?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converte TEXTO DIGITADO em quantidade ("2,5" → 2.5); null quando
 * vazio/inválido. Parser estrito (sem separador de milhar, sem
 * negativo) — é o MESMO que o salvamento do romaneio grava, então o
 * que o usuário vê no preview digitado bate com o que vai ao banco.
 */
export function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return null;
  if (!/^\d*\.?\d+$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Peso total (kg) de um item: quantidade × peso unitário.
 *
 * Arredonda o peso unitário ANTES da multiplicação, espelhando o trigger
 * do banco (075): o total exibido/importado fecha com o valor gravado.
 */
export function calculateTotalWeight(
  quantity: number | string | null | undefined,
  unitWeight: number | string | null | undefined,
): number | null {
  const qty = toNumber(quantity);
  const weight = toNumber(unitWeight);
  if (qty === null || weight === null) return null;
  return roundWeight(qty * roundWeight(weight));
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? `${singular}s`}`;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
