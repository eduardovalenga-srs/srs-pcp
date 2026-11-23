import { describe, expect, it } from "vitest";

import { buildScheduleIndex } from "@/lib/utils/sequenced-schedule";
import type { ProcessScheduleQueue } from "@/lib/types/scheduling";

function queue(overrides: Partial<ProcessScheduleQueue> = {}): ProcessScheduleQueue {
  return {
    processId: "process-exp",
    processCode: "EXP",
    anchorDate: "2026-10-19",
    rows: [
      {
        orderId: "o1",
        productGroupId: 1,
        weightKg: 5,
        capacityKg: 10,
        processConcluded: false,
        processCompletedAt: null,
        expConcluded: false,
        expCompletedAt: null,
      },
      {
        orderId: "o2",
        productGroupId: 1,
        weightKg: 10,
        capacityKg: 10,
        processConcluded: false,
        processCompletedAt: null,
        expConcluded: false,
        expCompletedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("buildScheduleIndex", () => {
  it("calculates each process queue cumulatively and uses the EXP window end for DP", () => {
    const schedule = buildScheduleIndex([queue()]);

    expect(schedule.windowsByOrder.o1.EXP).toEqual({
      start: "2026-10-19",
      end: "2026-10-19",
    });
    expect(schedule.windowsByOrder.o2.EXP).toEqual({
      start: "2026-10-19",
      end: "2026-10-20",
    });
    expect(schedule.expeditionByOrder).toEqual({
      o1: "2026-10-19",
      o2: "2026-10-20",
    });
  });

  it("shares one OF window across items and omits an uncalculable process", () => {
    const schedule = buildScheduleIndex([
      queue({
        processCode: "ACAB",
        rows: [
          {
            orderId: "o1",
            productGroupId: null,
            weightKg: 100,
            capacityKg: 20,
            processConcluded: false,
            processCompletedAt: null,
            expConcluded: false,
            expCompletedAt: null,
          },
        ],
      }),
    ]);

    expect(schedule.windowsByOrder.o1.ACAB).toBeUndefined();
    expect(schedule.expeditionByOrder.o1 ?? null).toBeNull();
  });

  it("uses the business-local effective EXP completion date for shipped orders", () => {
    const schedule = buildScheduleIndex([
      queue({
        rows: [
          {
            orderId: "shipped",
            productGroupId: 1,
            weightKg: 0,
            capacityKg: 10,
            processConcluded: true,
            processCompletedAt: "2026-10-20T02:00:00.000Z",
            expConcluded: true,
            // 02:00 UTC is still the prior calendar date in São Paulo.
            expCompletedAt: "2026-10-20T02:00:00.000Z",
          },
        ],
      }),
    ]);

    expect(schedule.windowsByOrder.shipped.EXP).toEqual({
      start: "2026-10-19",
      end: "2026-10-19",
    });
    expect(schedule.expeditionByOrder.shipped).toBe("2026-10-19");
  });

  it("uses the effective completion date for completed applicable processes", () => {
    const schedule = buildScheduleIndex([
      queue({
        processCode: "SOLDA",
        rows: [
          {
            orderId: "completed",
            productGroupId: 1,
            weightKg: 0,
            capacityKg: 10,
            processConcluded: true,
            processCompletedAt: "2026-10-20T02:00:00.000Z",
            expConcluded: false,
            expCompletedAt: null,
          },
        ],
      }),
    ]);

    expect(schedule.windowsByOrder.completed.SOLDA).toEqual({
      start: "2026-10-19",
      end: "2026-10-19",
    });
  });
});
