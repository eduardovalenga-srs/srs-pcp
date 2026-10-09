/** Formatação de números, quantidades e pesos. */

export function formatQuantity(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toLocaleString("pt-BR");
}

export function formatWeight(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return numeric.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
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

/** Peso total (kg) de um item: quantidade × peso unitário. */
export function calculateTotalWeight(
  quantity: number | string | null | undefined,
  unitWeight: number | string | null | undefined,
): number | null {
  const qty = toNumber(quantity);
  const weight = toNumber(unitWeight);
  if (qty === null || weight === null) return null;
  return qty * weight;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? `${singular}s`}`;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
