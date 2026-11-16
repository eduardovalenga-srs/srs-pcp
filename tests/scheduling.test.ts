import { describe, expect, it } from "vitest";

import type { SchedulingOrderRow } from "@/lib/types/scheduling";
import { computeScheduleRows, formatLoadDays } from "@/lib/utils/scheduling";

/**
 * Calendário de referência: 2026-10-05 = segunda-feira.
 * 05 seg · 06 ter · 07 qua · 08 qui · 09 sex · 12 seg (fim de semana pulado).
 */
const ANCHOR = "2026-10-05";

function makeRow(overrides: Partial<SchedulingOrderRow> = {}): SchedulingOrderRow {
  return {
    orderId: "00000000-0000-4000-8000-000000000001",
    orderCode: "OF 1",
    orderType: "OF",
    customerName: "Cliente",
    deliveryDate: "2026-12-01",
    orderStatus: "PLANEJADO",
    productGroupId: 12,
    familyDescription: "Estruturas metálicas",
    familyAbbreviation: "EST",
    groupType: "12-EST",
    quantity: 1,
    weightKg: 1000,
    capacityKg: 500,
    notes: null,
    ...overrides,
  };
}

describe("computeScheduleRows — carga e datas em dias úteis", () => {
  it("calcula peso ÷ capacidade e acumula a carga em dias úteis", () => {
    const rows = computeScheduleRows(
      [
        makeRow({ orderCode: "OF 1", weightKg: 1000, capacityKg: 500 }), // 2,0 dias
        makeRow({ orderCode: "OF 2", weightKg: 500, capacityKg: 500 }), // 1,0 dia
        makeRow({ orderCode: "OF 3", weightKg: 250, capacityKg: 500 }), // 0,5 dia
      ],
      ANCHOR,
    );

    expect(rows.map((row) => row.loadDays)).toEqual([2, 1, 0.5]);
    expect(rows.map((row) => row.startDate)).toEqual(["2026-10-05", "2026-10-07", "2026-10-08"]);
    expect(rows.map((row) => row.endDate)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(rows.every((row) => row.issue === null)).toBe(true);
  });

  it("pula o fim de semana ao atravessar a sexta-feira", () => {
    const rows = computeScheduleRows(
      [
        makeRow({ orderCode: "OF 1", weightKg: 2500, capacityKg: 500 }), // 5 dias (seg→sex)
        makeRow({ orderCode: "OF 2", weightKg: 500, capacityKg: 500 }), // 1 dia (seg seguinte)
      ],
      ANCHOR,
    );

    expect(rows[0]?.startDate).toBe("2026-10-05");
    expect(rows[0]?.endDate).toBe("2026-10-09");
    expect(rows[1]?.startDate).toBe("2026-10-12");
    expect(rows[1]?.endDate).toBe("2026-10-12");
  });

  it("âncora em fim de semana começa no próximo dia útil", () => {
    const rows = computeScheduleRows([makeRow({ weightKg: 500, capacityKg: 500 })], "2026-10-10");

    expect(rows[0]?.startDate).toBe("2026-10-12");
    expect(rows[0]?.endDate).toBe("2026-10-12");
  });

  it("OF sem peso não ocupa dias nem desloca a fila", () => {
    const rows = computeScheduleRows(
      [
        makeRow({ orderCode: "OF 1", weightKg: null }),
        makeRow({ orderCode: "OF 2", weightKg: 500, capacityKg: 500 }),
      ],
      ANCHOR,
    );

    expect(rows[0]).toMatchObject({
      issue: "OF sem peso calculado",
      loadDays: null,
      startDate: null,
      endDate: null,
    });
    expect(rows[1]?.startDate).toBe("2026-10-05");
  });

  it("OF sem família é sinalizada, mesmo com peso e capacidade", () => {
    const rows = computeScheduleRows(
      [
        makeRow({
          productGroupId: null,
          familyDescription: null,
          familyAbbreviation: null,
          groupType: null,
        }),
      ],
      ANCHOR,
    );

    expect(rows[0]?.issue).toBe("OF sem família cadastrada");
    expect(rows[0]?.startDate).toBeNull();
  });

  it("OF sem capacidade kg/dia no processo é sinalizada", () => {
    const rows = computeScheduleRows([makeRow({ capacityKg: null })], ANCHOR);
    expect(rows[0]?.issue).toBe("Sem capacidade em kg/dia para este processo");

    const zero = computeScheduleRows([makeRow({ capacityKg: 0 })], ANCHOR);
    expect(zero[0]?.issue).toBe("Sem capacidade em kg/dia para este processo");
  });

  it("data de início inválida invalida todas as linhas", () => {
    const rows = computeScheduleRows([makeRow()], "05/10/2026");
    expect(rows[0]?.issue).toBe("Data de início inválida");
  });
});

describe("formatLoadDays", () => {
  it("mostra uma casa decimal em pt-BR e travessão quando ausente", () => {
    expect(formatLoadDays(1.94)).toBe("1,9");
    expect(formatLoadDays(2)).toBe("2,0");
    expect(formatLoadDays(null)).toBe("—");
  });
});
