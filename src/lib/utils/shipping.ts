/**
 * 054 — Baixa derivada da expedição (espelho das fórmulas SQL da migração
 * `054_pending_shipped_totals.sql`; a fonte do expedido é sempre o banco).
 *
 * A emissão da nota no fim do romaneio (`confirm_romaneio`) NÃO decrementa
 * `order_items.quantity`: o que as telas exibem é o SALDO pendente, derivado
 * a cada leitura a partir dos romaneios `CONFIRMADOS` — cancelar um romaneio
 * restaura os números sozinho (nenhum contador é gravado).
 *
 * Nunca usar para persistir valores: só para exibição/filtro em memória.
 */

/**
 * Fração do planejado que JÁ foi expedida, limitada a [0, 1].
 * Planejado sem sentido (≤ 0) devolve 0 — quem usa trata a fração como
 * "nada expedido" (o item mantém o valor cheio, fail-safe da SQL).
 */
export function shippedFraction(planned: number, shipped: number): number {
  if (!Number.isFinite(planned) || planned <= 0) return 0;
  if (!Number.isFinite(shipped) || shipped <= 0) return 0;
  return Math.min(shipped / planned, 1);
}

/** Saldo de QUANTIDADE de um item raiz: greatest(planejado − expedido, 0). */
export function pendingQuantity(planned: number, shipped: number): number {
  if (!Number.isFinite(planned)) return 0;
  if (!Number.isFinite(shipped) || shipped <= 0) return planned;
  return Math.max(planned - shipped, 0);
}

/**
 * Saldo de PESO de um item raiz: greatest(total − expedido × peso unit., 0).
 * `totalWeightKg` null continua null (a tela exibe "—", regra 023).
 */
export function pendingWeight(
  totalWeightKg: number | null,
  shipped: number,
  unitWeightKg: number | null,
): number | null {
  if (totalWeightKg === null || !Number.isFinite(totalWeightKg)) return null;
  if (!Number.isFinite(shipped) || shipped <= 0 || unitWeightKg === null || !Number.isFinite(unitWeightKg)) {
    return totalWeightKg;
  }
  return Math.max(totalWeightKg - shipped * unitWeightKg, 0);
}

/**
 * Saldo de QUANTIDADE de um item FILHO: o planejado do filho escalado pela
 * fração pendente do PAI raiz (baixa proporcional — só itens raiz entram em
 * romaneio). Sem pai válido (ou pai sem planejado) a fração é 1 e o filho
 * mantém o valor cheio, igual ao `case ... else` da SQL.
 */
export function pendingRootQuantity(
  quantity: number,
  rootPlanned: number,
  rootShipped: number,
): number {
  if (!Number.isFinite(quantity)) return 0;
  return quantity * (1 - shippedFraction(rootPlanned, rootShipped));
}

/**
 * Saldo de PESO de um item FILHO: total planejado escalado pela MESMA
 * fração pendente do pai. `totalWeightKg` null continua null ("—").
 */
export function pendingRootWeight(
  totalWeightKg: number | null,
  rootPlanned: number,
  rootShipped: number,
): number | null {
  if (totalWeightKg === null || !Number.isFinite(totalWeightKg)) return null;
  return totalWeightKg * (1 - shippedFraction(rootPlanned, rootShipped));
}
