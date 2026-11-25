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
      o1: "2026-10-21",
      o2: "2026-10-27",
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

    expect(original.expeditionByOrder.o1).toBe("2026-10-26");
    expect(reordered.expeditionByOrder.o2).toBe("2026-10-21");
    expect(reordered.expeditionByOrder.o1).toBe("2026-10-27");
  });

  it("keeps the selected process date fixed when predecessors finish in time", () => {
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
      { processId: "process-PREMONT", anchorDate: "2026-10-23" },
    );

    // CORTE termina quinta-feira; a data fixa de PREMONT é sexta-feira.
    expect(result.windowsByOrder.o1.PREMONT.startDate).toBe("2026-10-23");
    // EXP tem quatro dias úteis e a expedição reserva mais um dia útil.
    expect(result.expeditionByOrder.o1).toBe("2026-11-02");
  });

  it("uses the catalog lead time as a minimum in business days", () => {
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

  it("recalculates an earlier process backwards from the fixed start", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [order("o1", 8, 2)]),
        queue("PREMONT", [order("o1", 2, 2)]),
        queue("EXP", [order("o1", 2, 2)]),
      ],
      [process("CORTE", 10), process("PREMONT", 20), process("EXP", 30)],
      [],
      { processId: "process-PREMONT", anchorDate: "2026-10-22" },
    );

    expect(result.windowsByOrder.o1.CORTE).toEqual({
      loadDays: 4,
      startDate: "2026-10-16",
      endDate: "2026-10-21",
      issue: null,
    });
    expect(result.windowsByOrder.o1.PREMONT).toMatchObject({
      startDate: "2026-10-22",
      issue: null,
    });
    expect(result.expeditionByOrder.o1).toBe("2026-10-26");
  });

  it("respects shared capacity while back-planning a preceding process queue", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [order("o1", 4, 2), order("o2", 2, 2)]),
        queue("PREMONT", [order("o1", 2, 2), order("o2", 2, 2)]),
      ],
      [process("CORTE", 10), process("PREMONT", 20)],
      [],
      { processId: "process-PREMONT", anchorDate: "2026-10-26" },
    );

    expect(result.windowsByOrder.o1.CORTE).toMatchObject({
      startDate: "2026-10-22",
      endDate: "2026-10-23",
    });
    expect(result.windowsByOrder.o2.CORTE).toMatchObject({
      startDate: "2026-10-26",
      endDate: "2026-10-26",
    });
    expect(result.windowsByOrder.o1.PREMONT.startDate).toBe("2026-10-26");
    expect(result.windowsByOrder.o2.PREMONT.startDate).toBe("2026-10-27");
  });

  it("keeps a completed predecessor date and starts the pending stage on the next business day", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [
          order("o1", 0, 2, {
            processConcluded: true,
            processCompletedAt: "2026-10-16",
          }),
          order("o2", 0, 2, {
            processConcluded: true,
            processCompletedAt: "2026-10-09",
          }),
        ]),
        queue("KIT", [order("o1", 8, 2), order("o2", 2, 2)]),
        queue("PRE_MTG", [
          order("o1", 2, 2),
          order("o2", 0, 2, {
            processConcluded: true,
            processCompletedAt: "2026-10-13",
          }),
        ]),
      ],
      [process("CORTE", 10), process("KIT", 20), process("PRE_MTG", 30)],
      [],
      { processId: "process-PRE_MTG", anchorDate: "2026-10-26" },
    );

    expect(result.windowsByOrder.o1.CORTE).toEqual({
      loadDays: 0,
      startDate: "2026-10-16",
      endDate: "2026-10-16",
      issue: null,
    });
    expect(result.windowsByOrder.o1.KIT).toMatchObject({
      startDate: "2026-10-19",
      endDate: "2026-10-22",
      issue: null,
    });
    expect(result.windowsByOrder.o1.PRE_MTG.issue).toBeNull();
    expect(result.expeditionByOrder.o1).toBe("2026-10-27");
    // A different OF's impossible historical deadline must not drag o1
    // backwards through its completed CORTE date.
    expect(result.windowsByOrder.o2.KIT.issue).toBeTruthy();
  });

  it("reports an explicit conflict when a completed predecessor leaves too little time", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [
          order("o1", 0, 2, {
            processConcluded: true,
            processCompletedAt: "2026-10-23",
          }),
        ]),
        queue("KIT", [order("o1", 8, 2)]),
        queue("PRE_MTG", [order("o1", 2, 2)]),
      ],
      [process("CORTE", 10), process("KIT", 20), process("PRE_MTG", 30)],
      [],
      { processId: "process-PRE_MTG", anchorDate: "2026-10-26" },
    );

    expect(result.windowsByOrder.o1.CORTE?.endDate).toBe("2026-10-23");
    expect(result.windowsByOrder.o1.KIT).toMatchObject({
      startDate: "2026-10-26",
      issue: "A conclusão da etapa anterior não cabe antes do prazo da próxima etapa",
    });
    expect(result.windowsByOrder.o1.PRE_MTG.issue).toContain("Etapa anterior");
    expect(result.expeditionByOrder.o1).toBeNull();
  });

  it("flags a conflict if a completed preceding process is later than the fixed start", () => {
    const result = computeProductionChainSchedule(
      [
        queue("CORTE", [
          order("o1", 0, 2, {
            processConcluded: true,
            // 02:00 UTC is Friday 23/10 in the business timezone.
            processCompletedAt: "2026-10-24T02:00:00.000Z",
          }),
        ]),
        queue("PREMONT", [order("o1", 2, 2)]),
      ],
      [process("CORTE", 10), process("PREMONT", 20)],
      [],
      { processId: "process-PREMONT", anchorDate: "2026-10-21" },
    );

    expect(result.windowsByOrder.o1.PREMONT).toMatchObject({
      startDate: "2026-10-21",
      issue: "Etapa anterior termina após a data fixa deste processo",
    });
    expect(result.expeditionByOrder.o1).toBeNull();
  });

  it("rejects a weekend as the fixed start date instead of silently rolling it", () => {
    const result = computeProductionChainSchedule(
      [queue("CORTE", [order("o1", 2, 2)])],
      [process("CORTE", 10)],
      [],
      { processId: "process-CORTE", anchorDate: "2026-10-10" },
    );

    expect(result.windowsByOrder.o1.CORTE.issue).toBe("A data fixa deve ser um dia útil");
    expect(result.expeditionByOrder.o1).toBeNull();
  });

  it("sets the planned MP receipt one business day before the first manufacturing process", () => {
    const result = computeProductionChainSchedule(
      [
        queue("MP", [
          order("o1", 1, 1, {
            processConcluded: true,
            // 02:00 UTC is still Friday in the business timezone.
            processCompletedAt: "2026-10-17T02:00:00.000Z",
          }),
        ]),
        queue("CORTE", [order("o1", 1, 1)]),
      ],
      [process("MP", 5), process("CORTE", 10)],
    );

    // The first manufacturing process starts Monday; MP must be available
    // the previous business day, Friday.
    expect(result.windowsByOrder.o1.CORTE.startDate).toBe("2026-10-19");
    expect(result.materialReceiptByOrder.o1).toBe("2026-10-16");
  });

  it("does not require production capacity for MP and exposes only its receipt date", () => {
    const result = computeProductionChainSchedule(
      [
        queue("MP", [order("o1", 1000, 0)]),
        queue("CORTE", [order("o1", 1000, 500)]),
        queue("PRE_MTG", [order("o1", 500, 500)]),
      ],
      [process("MP", 5, 10), process("CORTE", 10, 1), process("PRE_MTG", 20, 1)],
      [],
      { processId: "process-PRE_MTG", anchorDate: "2026-10-22" },
    );

    expect(result.windowsByOrder.o1.MP).toEqual({
      loadDays: 0,
      startDate: "2026-10-19",
      endDate: "2026-10-19",
      issue: null,
    });
    expect(result.windowsByOrder.o1.CORTE).toMatchObject({
      loadDays: 2,
      startDate: "2026-10-20",
      endDate: "2026-10-21",
      issue: null,
    });
    expect(result.windowsByOrder.o1.PRE_MTG.startDate).toBe("2026-10-22");
    expect(result.materialReceiptByOrder.o1).toBe("2026-10-19");
    expect(result.expeditionByOrder.o1).toBe("2026-10-23");
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
    expect(result.expeditionByOrder.o1).toBe("2026-10-22");
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
