import { describe, expect, it } from "vitest";

import type { ProcessScheduleQueue } from "@/lib/types/scheduling";
import { computeProductionChainSchedule } from "@/lib/utils/scheduling";

function queue(
  processCode: string,
  rows: ProcessScheduleQueue["rows"],
  anchorDate = "2026-10-19",
): ProcessScheduleQueue {
  return {
    processId: `process-${processCode}`,
    processCode,
    anchorDate,
    rows,
  };
}

function process(code: string, displayOrder: number, durationDays = 1) {
  return {
    id: `process-${code}`,
    code,
    displayOrder,
    durationDays,
  };
}

function order(
  orderId: string,
  weightKg: number | null,
  capacityKg: number | null,
  overrides: Partial<ProcessScheduleQueue["rows"][number]> = {},
): ProcessScheduleQueue["rows"][number] {
  return {
    orderId,
    productGroupId: 1,
    weightKg,
    capacityKg,
    processConcluded: false,
    processCompletedAt: null,
    expConcluded: false,
    expCompletedAt: null,
    ...overrides,
  };
}

describe("computeProductionChainSchedule", () => {
  it("waits until the next business day and respects each process capacity", () => {
    const queues = [
      queue("CORTE", [order("o1", 2, 2), order("o2", 8, 2)]),
      queue("EXP", [order("o1", 2, 2), order("o2", 2, 2)]),
    ];
    const result = computeProductionChainSchedule(
      queues,
      [process("CORTE", 10), process("EXP", 20)],
    );

    expect(result.expeditionByOrder).toEqual({
      o1: "2026-10-20",
      o2: "2026-10-26",
    });
  });

  it("uses the unsaved global order in every process queue", () => {
    const queues = [
      queue("CORTE", [order("o1", 8, 2), order("o2", 2, 2)]),
      queue("EXP", [order("o1", 2, 2), order("o2", 2, 2)]),
    ];
    const processes = [process("CORTE", 10), process("EXP", 20)];

    const original = computeProductionChainSchedule(queues, processes);
    const reordered = computeProductionChainSchedule(queues, processes, ["o2", "o1"]);

    expect(original.expeditionByOrder.o1).toBe("2026-10-23");
    expect(reordered.expeditionByOrder.o2).toBe("2026-10-20");
    expect(reordered.expeditionByOrder.o1).toBe("2026-10-26");
  });

  it("uses the selected process date, predecessor completion and later-process lead time", () => {
    const queues = [
      queue("EXP", [order("o1", 2, 2)]),
      queue("PREMONT", [order("o1", 2, 2)]),
      queue("CORTE", [order("o1", 8, 2)]),
    ];
    const processes = [
      process("CORTE", 10),
      process("PREMONT", 20, 2),
      process("EXP", 30, 4),
    ];
    const result = computeProductionChainSchedule(
      queues,
      processes,
      [],
      { processId: "process-PREMONT", anchorDate: "2026-10-21" },
    );

    // CORTE termina qui, então PREMONT só pode começar na sexta-feira.
    expect(result.windowsByOrder.o1.PREMONT.startDate).toBe("2026-10-23");
    // O lead time de quatro dias corridos da EXP termina na quinta seguinte.
    expect(result.expeditionByOrder.o1).toBe("2026-10-29");
  });

  it("uses the catalog lead time as a minimum in calendar days", () => {
    const result = computeProductionChainSchedule(
      [queue("PREMONT", [order("o1", 2, 100)])],
      [process("PREMONT", 10, 4)],
    );

    expect(result.windowsByOrder.o1.PREMONT).toEqual({
      loadDays: 0.02,
      startDate: "2026-10-19",
      endDate: "2026-10-22",
      issue: null,
    });
  });

  it("uses the effective completion date before scheduling the next process", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [
          order("o1", 0, 2, {
            processConcluded: true,
            processCompletedAt: "2026-10-21T02:00:00.000Z",
          }),
        ]),
        queue("EXP", [order("o1", 2, 2)]),
      ],
      [process("CORTE", 10), process("EXP", 20)],
    );

    // A conclusão cai em 20/10 no fuso do negócio; a próxima etapa inicia
    // no próximo dia útil.
    expect(result.expeditionByOrder.o1).toBe("2026-10-21");
  });

  it("leaves the date unavailable when a required process lacks capacity", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [order("o1", 2, null)]),
        queue("EXP", [order("o1", 2, 2)]),
      ],
      [process("CORTE", 10), process("EXP", 20)],
    );

    expect(result.expeditionByOrder.o1).toBeNull();
  });
});
