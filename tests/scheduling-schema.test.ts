import { describe, expect, it } from "vitest";

import { saveProcessScheduleSchema } from "@/lib/validators/scheduling.schema";

const PROCESS_ID = "00000000-0000-4000-8000-000000000001";

describe("saveProcessScheduleSchema — data fixa", () => {
  it("aceita uma data útil para o início do processo", () => {
    const result = saveProcessScheduleSchema.safeParse({
      processId: PROCESS_ID,
      anchorDate: "2026-10-09",
      rows: [],
    });

    expect(result.success).toBe(true);
  });

  it("recusa sábado ou domingo como data fixa", () => {
    const result = saveProcessScheduleSchema.safeParse({
      processId: PROCESS_ID,
      anchorDate: "2026-10-10",
      rows: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("dia útil"))).toBe(true);
    }
  });
});
