import { describe, expect, it } from "vitest";

import type { CompletedWeightStats } from "@/lib/types/production";
import {
  completedWeightEvolutionSeries,
  mergeCompletedWeightStats,
} from "@/lib/utils/completed-weight";

function stats(
  groupId: number,
  weightKg: number,
  processes: Array<{ code: string; weightKg: number; quantity: number }>,
): CompletedWeightStats {
  return {
    granularity: "month",
    anchor: "2026-11-01",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    processCode: null,
    productGroupId: groupId,
    withoutProductGroup: false,
    processes: processes.map((process) => ({
      ...process,
      name: process.code,
      displayOrder: process.code === "ACAB" ? 100 : 200,
      cells: 1,
      items: 1,
    })),
    groups: [
      {
        id: groupId,
        name: `Grupo ${groupId}`,
        abbreviation: `G${groupId}`,
        weightKg,
        quantity: 1,
        cells: 1,
        items: 1,
      },
    ],
    total: { weightKg, quantity: 1 },
    previous: { weightKg: weightKg / 2, quantity: 1 },
    days: [
      {
        date: "2026-11-05",
        processes: processes.map((process) => ({ ...process, cells: 1 })),
      },
    ],
    series: [
      {
        bucket: "2026-11-01",
        weightKg,
        quantity: 1,
        processes: processes.map((process) => ({ ...process, cells: 1 })),
      },
    ],
  };
}

describe("completed weight dashboard data", () => {
  it("combines selected families across totals, daily rows, and series", () => {
    const groupA = stats(1, 10, [{ code: "ACAB", weightKg: 10, quantity: 1 }]);
    const groupB = stats(2, 8, [
      { code: "ACAB", weightKg: 5, quantity: 1 },
      { code: "EXP", weightKg: 3, quantity: 1 },
    ]);
    const combined = mergeCompletedWeightStats([groupA, groupB], [1, 2], false);

    expect(combined?.total).toEqual({ weightKg: 18, quantity: 2 });
    expect(combined?.previous.weightKg).toBe(9);
    expect(combined?.processes.map(({ code, weightKg }) => [code, weightKg])).toEqual([
      ["ACAB", 15],
      ["EXP", 3],
    ]);
    expect(combined?.days[0]?.processes.map(({ code, weightKg }) => [code, weightKg])).toEqual([
      ["ACAB", 15],
      ["EXP", 3],
    ]);
    expect(combined?.series[0]?.weightKg).toBe(18);
    expect(combined?.groups).toEqual(groupA.groups);
    expect(combined?.productGroupId).toBeNull();
  });

  it("uses EXP for the evolution chart unless a process is explicitly selected", () => {
    const source = stats(1, 10, [
      { code: "ACAB", weightKg: 10, quantity: 1 },
      { code: "EXP", weightKg: 4, quantity: 1 },
    ]).series;

    expect(completedWeightEvolutionSeries(source, "EXP")[0]?.weightKg).toBe(4);
    expect(completedWeightEvolutionSeries(source, "ACAB")[0]?.weightKg).toBe(10);
  });
});
