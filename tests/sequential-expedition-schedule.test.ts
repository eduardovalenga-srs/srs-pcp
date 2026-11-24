import { describe, expect, it } from "vitest";

import type { ProcessScheduleQueue } from "@/lib/types/scheduling";
import { computeSequentialExpeditionDates } from "@/lib/utils/scheduling";

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

describe("computeSequentialExpeditionDates", () => {
  it("waits for each OF to finish the previous applicable process", () => {
    const dates = computeSequentialExpeditionDates([
      queue("CORTE", [order("o1", 2, 2), order("o2", 8, 2)]),
      queue("EXP", [order("o1", 2, 2), order("o2", 2, 2)]),
    ]);

    expect(dates).toEqual({
      o1: "2026-10-19",
      o2: "2026-10-23",
    });
  });

  it("uses the unsaved global order within each process queue", () => {
    const queues = [
      queue("CORTE", [order("o1", 8, 2), order("o2", 2, 2)]),
      queue("EXP", [order("o1", 2, 2), order("o2", 2, 2)]),
    ];

    const originalOrder = computeSequentialExpeditionDates(queues);
    const changedOrder = computeSequentialExpeditionDates(queues, ["o2", "o1"]);

    expect(originalOrder.o1).toBe("2026-10-22");
    expect(changedOrder.o2).toBe("2026-10-19");
    expect(changedOrder.o1).toBe("2026-10-23");
  });

  it("uses the effective completion date for completed processes", () => {
    const dates = computeSequentialExpeditionDates([
      queue("CORTE", [
        order("o1", 0, 2, {
          processConcluded: true,
          processCompletedAt: "2026-10-21T02:00:00.000Z",
        }),
      ]),
      queue("EXP", [order("o1", 2, 2)]),
    ]);

    // 02:00 UTC ainda corresponde ao dia anterior no fuso de São Paulo.
    expect(dates.o1).toBe("2026-10-20");
  });

  it("leaves the date unavailable when a required process lacks capacity", () => {
    const dates = computeSequentialExpeditionDates([
      queue("CORTE", [order("o1", 2, null)]),
      queue("EXP", [order("o1", 2, 2)]),
    ]);

    expect(dates.o1).toBeNull();
  });
});
