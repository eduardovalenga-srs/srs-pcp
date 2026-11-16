import { describe, expect, it } from "vitest";

import {
  mpReceiptFreeItemSchema,
  mpReceiptMaterialSchema,
} from "@/lib/validators/mp-receipt.schema";

describe("mpReceipt schemas — pesos em 2 casas", () => {
  it("normaliza kg recebidos e materiais livres em KG", () => {
    const received = mpReceiptMaterialSchema.safeParse({
      materialKey: "CHAPA::KG",
      description: "Chapa",
      unit: "KG",
      quantityKg: "1,005",
    });
    const freeKg = mpReceiptFreeItemSchema.safeParse({
      description: "Chapa avulsa",
      unit: "KG",
      quantity: "1,005",
    });

    expect(received.success && received.data.quantityKg).toBe(1.01);
    expect(freeKg.success && freeKg.data.quantity).toBe(1.01);
  });

  it("preserva a precisão de unidades não ponderais no material livre", () => {
    const result = mpReceiptFreeItemSchema.safeParse({
      description: "Perfil",
      unit: "M",
      quantity: "1,234",
    });
    expect(result.success && result.data.quantity).toBe(1.234);
  });
});
