import { describe, expect, it } from "vitest";

import { ACAB_PROCESS_CODE, SHIPMENT_PROCESS_CODE } from "@/lib/constants/processes";
import type { ProcessCell } from "@/lib/types/production";
import type { OrderScheduleIndex } from "@/lib/types/scheduling";
import {
  isAcabOverdue,
  processWindowForItem,
  productionRowsTotals,
} from "@/lib/utils/production";

/**
 * REGRA DO ACAB — card "Atrasados" da Fábrica 2: o item conta quando a data
 * da coluna ACAB (início previsto da janela) é anterior à data de referência.
 *
 * 2026-10-20 é terça-feira; as datas dos fixtures caem em dias conhecidos
 * (10-16 sexta, 10-23 sexta, 10-27 terça).
 */
const TODAY = "2026-10-20";

const SCHEDULE: OrderScheduleIndex = {
  windowsByOrder: {
    o1: {
      [ACAB_PROCESS_CODE]: { start: "2026-10-19", end: "2026-10-20" },
      [SHIPMENT_PROCESS_CODE]: { start: "2026-10-21", end: "2026-10-21" },
    },
  },
  expeditionByOrder: {},
};

function cell(status: ProcessCell["status"]): ProcessCell {
  return {
    id: `pp-${status}`,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
  };
}

/** Item da Fábrica 2 com apenas os campos que a regra lê. */
function item(
  overrides: Partial<{
    deliveryDate: string | null;
    acab: ProcessCell["status"] | null;
    exp: ProcessCell["status"] | null;
  }> = {},
) {
  const { deliveryDate = "2026-10-16", acab = "NAO_INICIADO", exp = "NAO_INICIADO" } = overrides;
  const processes: Record<string, ProcessCell> = {};
  if (acab !== null) processes[ACAB_PROCESS_CODE] = cell(acab);
  processes.QUALITY = cell("NAO_INICIADO");
  if (exp !== null) processes[SHIPMENT_PROCESS_CODE] = cell(exp);
  return { orderId: "o1", deliveryDate, processes };
}

describe("janela do ACAB no item da Fábrica 2", () => {
  it("usa a janela do sequenciamento da OF, mesmo se a entrega do item divergir", () => {
    expect(processWindowForItem(item({ deliveryDate: "2099-01-02" }), SCHEDULE, ACAB_PROCESS_CODE)).toEqual({
      start: "2026-10-19",
      end: "2026-10-20",
    });
  });

  it("sem janela no índice devolve null", () => {
    expect(processWindowForItem(item(), { windowsByOrder: {}, expeditionByOrder: {} }, ACAB_PROCESS_CODE)).toBeNull();
  });
});

describe("isAcabOverdue — card Atrasados da Fábrica 2", () => {
  it("conta quando o início do ACAB é anterior a hoje", () => {
    expect(isAcabOverdue(item(), SCHEDULE, TODAY)).toBe(true);
  });

  it("entrega alterada não muda se a janela agendada está vencida", () => {
    expect(isAcabOverdue(item({ deliveryDate: "2026-10-27" }), SCHEDULE, TODAY)).toBe(true);
  });

  it("não conta quando o início do ACAB é hoje ou futuro", () => {
    const todaySchedule: OrderScheduleIndex = {
      windowsByOrder: { o1: { ACAB: { start: TODAY, end: TODAY } } },
      expeditionByOrder: {},
    };
    const futureSchedule: OrderScheduleIndex = {
      windowsByOrder: { o1: { ACAB: { start: "2026-10-21", end: "2026-10-21" } } },
      expeditionByOrder: {},
    };
    expect(isAcabOverdue(item(), todaySchedule, TODAY)).toBe(false);
    expect(isAcabOverdue(item(), futureSchedule, TODAY)).toBe(false);
  });

  it("ACAB CONCLUIDO nunca fica atrasado (data passada é esperada)", () => {
    expect(isAcabOverdue(item({ acab: "CONCLUIDO" }), SCHEDULE, TODAY)).toBe(false);
  });

  it("ACAB NAO_APLICAVEL ou ausente no item não conta", () => {
    expect(isAcabOverdue(item({ acab: "NAO_APLICAVEL" }), SCHEDULE, TODAY)).toBe(false);
    expect(isAcabOverdue(item({ acab: null }), SCHEDULE, TODAY)).toBe(false);
  });

  it("sem janela no sequenciamento nunca fica atrasado", () => {
    expect(isAcabOverdue(item({ deliveryDate: null }), { windowsByOrder: {}, expeditionByOrder: {} }, TODAY)).toBe(false);
  });

  it("não depende da expedição: EXP concluída não esconde o ACAB vencido", () => {
    expect(isAcabOverdue(item({ exp: "CONCLUIDO" }), SCHEDULE, TODAY)).toBe(true);
  });
});

describe("productionRowsTotals — três números do card", () => {
  it("soma registros, quantidades e peso (item sem peso entra como 0)", () => {
    expect(
      productionRowsTotals([
        { quantity: 4, unitWeightKg: 1.5 },
        { quantity: 2, unitWeightKg: null },
        { quantity: 1, unitWeightKg: 2 },
      ]),
    ).toEqual({ records: 3, qty: 7, weight: 8 });
  });

  it("recorte vazio zera os três números", () => {
    expect(productionRowsTotals([])).toEqual({ records: 0, qty: 0, weight: 0 });
  });
});
