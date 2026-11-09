import { describe, expect, it } from "vitest";

import {
  pendingQuantity,
  pendingRootQuantity,
  pendingRootWeight,
  pendingWeight,
  shippedFraction,
} from "@/lib/utils/shipping";

/**
 * 054 — espelho das fórmulas da migração `054_pending_shipped_totals.sql`:
 * a expedição (romaneios CONFIRMADOS) derive o SALDO exibido; o planejado
 * (`order_items.quantity`/`total_weight_kg`) nunca é decrementado.
 */
describe("shippedFraction", () => {
  it("devolve a fração expedida limitada a [0, 1]", () => {
    expect(shippedFraction(100, 40)).toBeCloseTo(0.4);
    expect(shippedFraction(100, 100)).toBe(1);
    // Expedido acima do planejado (dado inconsistente) satura em 1.
    expect(shippedFraction(100, 150)).toBe(1);
  });

  it("planejado sem sentido (≤ 0) ou sem expedição devolve 0 (nada expedido)", () => {
    expect(shippedFraction(0, 10)).toBe(0);
    expect(shippedFraction(-5, 10)).toBe(0);
    expect(shippedFraction(Number.NaN, 10)).toBe(0);
    expect(shippedFraction(100, 0)).toBe(0);
    expect(shippedFraction(100, -1)).toBe(0);
  });
});

describe("pendingQuantity — item raiz", () => {
  it("greatest(planejado − expedido, 0)", () => {
    expect(pendingQuantity(100, 40)).toBe(60);
    expect(pendingQuantity(100, 100)).toBe(0);
    // Nunca negativo (expedição maior que o planejado).
    expect(pendingQuantity(100, 150)).toBe(0);
  });

  it("sem expedição mantém o planejado; sem planejado cai em 0", () => {
    expect(pendingQuantity(100, 0)).toBe(100);
    expect(pendingQuantity(100, -5)).toBe(100);
    expect(pendingQuantity(Number.NaN, 10)).toBe(0);
  });
});

describe("pendingWeight — peso do item raiz", () => {
  it("greatest(total − expedido × peso unit., 0)", () => {
    // 100 × 2 kg = 200 kg; expediu 40 × 2 = 80 kg → sobra 120 kg.
    expect(pendingWeight(200, 40, 2)).toBe(120);
    expect(pendingWeight(200, 100, 2)).toBe(0);
    expect(pendingWeight(200, 150, 2)).toBe(0);
  });

  it("total nulo permanece nulo (exibição \"—\", regra 023)", () => {
    expect(pendingWeight(null, 40, 2)).toBeNull();
  });

  it("sem expedição ou sem peso unitário mantém o total", () => {
    expect(pendingWeight(200, 0, 2)).toBe(200);
    expect(pendingWeight(200, 40, null)).toBe(200);
    expect(pendingWeight(200, 40, Number.NaN)).toBe(200);
  });
});

describe("pendingRootQuantity — filho (fração pendente do pai raiz)", () => {
  it("escala o planejado do filho pela fração que falta do pai", () => {
    // Pai 100, expediu 40 → fração pendente 0,6 → filho 10 vira 6.
    expect(pendingRootQuantity(10, 100, 40)).toBeCloseTo(6);
    // Pai 100%, expediu 100 → filho zera.
    expect(pendingRootQuantity(10, 100, 100)).toBeCloseTo(0);
    // Nada expedido → filho mantém o valor cheio.
    expect(pendingRootQuantity(10, 100, 0)).toBe(10);
  });

  it("pai ausente/sem planejado (fração 1) mantém o filho cheio", () => {
    // Pai fora do resultado ⇒ raizPlanned = 0 → shippedFraction = 0 → cheio.
    expect(pendingRootQuantity(10, 0, 0)).toBe(10);
    expect(pendingRootQuantity(10, 0, 50)).toBe(10);
    // Expedido acima do planejado do pai satura em 1 → filho zera.
    expect(pendingRootQuantity(10, 100, 150)).toBe(0);
    expect(pendingRootQuantity(Number.NaN, 100, 0)).toBe(0);
  });
});

describe("pendingRootWeight — peso do filho (mesma fração do pai)", () => {
  it("escala o total do filho pela fração pendente do pai", () => {
    // Filho 10 kg, pai com 60% pendente → 6 kg.
    expect(pendingRootWeight(10, 100, 40)).toBeCloseTo(6);
    expect(pendingRootWeight(10, 100, 100)).toBeCloseTo(0);
    expect(pendingRootWeight(10, 100, 0)).toBe(10);
  });

  it("total nulo permanece nulo; pai sem planejado mantém o cheio", () => {
    expect(pendingRootWeight(null, 100, 40)).toBeNull();
    expect(pendingRootWeight(10, 0, 0)).toBe(10);
    expect(pendingRootWeight(10, 0, 50)).toBe(10);
  });
});

describe("consistência entre quantidade e peso (054)", () => {
  it("raiz: o expedido × peso unitário fecha com o delta do peso", () => {
    const planned = 100;
    const shipped = 40;
    const unit = 2;
    const pending = pendingQuantity(planned, shipped);
    const weight = pendingWeight(planned * unit, shipped, unit);
    expect(pending).toBe(60);
    expect(weight).toBe(pending * unit);
    // Soma planejado = expedido + pendente (nada se perde nem duplica).
    expect(shipped + pending).toBe(planned);
  });

  it("filho: quantidade e peso usam a MESMA fração do pai", () => {
    const fraction = 1 - shippedFraction(100, 40);
    expect(pendingRootQuantity(10, 100, 40)).toBeCloseTo(10 * fraction);
    expect(pendingRootWeight(10, 100, 40)).toBeCloseTo(10 * fraction);
  });
});
