import { describe, expect, it } from "vitest";

import { saveProductGroupSchema } from "@/lib/validators/product-group.schema";

const capacity = {
  factory: "Fábrica 1",
  processId: "2f42a6aa-8ce2-4da8-9e39-65c9ed197b4a",
  unit: "KG",
  capacity: "125,5",
};

const base = {
  familyDescription: "  Estruturas metálicas ",
  familyAbbreviation: "est",
  capacities: [capacity],
};

describe("saveProductGroupSchema", () => {
  it("normaliza a abreviação e aceita capacidade decimal com vírgula", () => {
    const parsed = saveProductGroupSchema.safeParse(base);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.familyDescription).toBe("Estruturas metálicas");
    expect(parsed.data.familyAbbreviation).toBe("EST");
    expect(parsed.data.capacities[0]?.capacity).toBe(125.5);
    expect(parsed.data.id).toBeUndefined();
  });

  it("limita a abreviação a três caracteres", () => {
    const parsed = saveProductGroupSchema.safeParse({ ...base, familyAbbreviation: "ESTR" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("A abreviação deve ter no máximo 3 caracteres");
    }
  });

  it("não aceita abreviação com caracteres fora de letras e números", () => {
    const parsed = saveProductGroupSchema.safeParse({ ...base, familyAbbreviation: "E-1" });
    expect(parsed.success).toBe(false);
  });

  it("aceita diferentes unidades para o mesmo processo", () => {
    const parsed = saveProductGroupSchema.safeParse({
      ...base,
      capacities: [
        capacity,
        { ...capacity, unit: "M2", capacity: 80 },
        { ...capacity, unit: "UNIDADES", capacity: "25" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita a mesma unidade duplicada no processo/fábrica", () => {
    const parsed = saveProductGroupSchema.safeParse({
      ...base,
      capacities: [capacity, capacity],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.message === "Unidade repetida para este processo e fábrica"),
      ).toBe(true);
    }
  });

  it("rejeita capacidade vazia ou negativa", () => {
    for (const value of ["", "-2"]) {
      const parsed = saveProductGroupSchema.safeParse({
        ...base,
        capacities: [{ ...capacity, capacity: value }],
      });
      expect(parsed.success).toBe(false);
    }
  });
});
