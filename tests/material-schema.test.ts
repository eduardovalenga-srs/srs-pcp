import { describe, expect, it } from "vitest";

import { MAX_MATERIALS_PER_ITEM, MATERIAL_UNITS } from "@/lib/constants/materials";
import { firstZodMessage } from "@/lib/validators/common";
import { materialSchema, materialsSchema, type MaterialInput } from "@/lib/validators/material.schema";
import { orderWithItemsSchema } from "@/lib/validators/order-item.schema";

type Parsed =
  | { success: true; data: unknown }
  | { success: false; error: { issues: { message: string }[] } };

function messageOf(result: Parsed): string {
  if (result.success) throw new Error("esperava falha de validação, mas os dados são válidos");
  return firstZodMessage(result.error as Parameters<typeof firstZodMessage>[0]) ?? "";
}

function material(overrides: Partial<MaterialInput> = {}): MaterialInput {
  return { description: "Chapa xadrez 3 mm", quantity: "12,5", unit: "KG", notes: "", ...overrides };
}

describe("material.schema", () => {
  it("aceita o material digitado no form e converte quantidade", () => {
    const result = materialSchema.safeParse(material());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.quantity).toBe(12.5);
    expect(result.data.notes).toBeNull();
    expect(result.data.unit).toBe("KG");
  });

  it("aceita quantidade já vindo como número (re-salvamento/edição)", () => {
    const result = materialSchema.safeParse(material({ quantity: 8 }));
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { quantity: number }).quantity).toBe(8);
  });

  it("recusa descrição vazia com mensagem própria em pt-BR", () => {
    expect(messageOf(materialSchema.safeParse(material({ description: "   " })))).toMatch(
      /Informe o material/,
    );
  });

  it("recusa quantidade zero, negativa ou ausente", () => {
    expect(messageOf(materialSchema.safeParse(material({ quantity: "0" })))).toMatch(
      /maior ou igual a 0\.001/,
    );
    expect(messageOf(materialSchema.safeParse(material({ quantity: "-2" })))).toMatch(
      /maior ou igual a 0\.001/,
    );
    expect(messageOf(materialSchema.safeParse(material({ quantity: "" })))).toMatch(/obrigatório/);
    expect(messageOf(materialSchema.safeParse(material({ quantity: "abc" })))).toMatch(
      /inválido/,
    );
  });

  it("recusa unidade fora da lista oficial", () => {
    expect(
      messageOf(materialSchema.safeParse(material({ unit: "TONELADA" as MaterialInput["unit"] }))),
    ).toBeTruthy();
  });

  it("aceita todas as unidades de MATERIAL_UNITS", () => {
    for (const unit of MATERIAL_UNITS) {
      expect(materialSchema.safeParse(material({ unit })).success).toBe(true);
    }
  });

  it(`limita a ${MAX_MATERIALS_PER_ITEM} materiais por item`, () => {
    const many = (count: number): MaterialInput[] =>
      Array.from({ length: count }, (_, index) =>
        material({ description: `Material ${index + 1}` }),
      );

    expect(materialsSchema.safeParse(many(MAX_MATERIALS_PER_ITEM)).success).toBe(true);
    const excess = materialsSchema.safeParse(many(MAX_MATERIALS_PER_ITEM + 1));
    expect(excess.success).toBe(false);
    if (!excess.success) expect(messageOf(excess)).toMatch(/50/);
  });

  it("item sem materiais nasce com lista vazia no orderWithItemsSchema", () => {
    const parsed = orderWithItemsSchema.safeParse({
      type: "OF",
      code: "OF-777",
      customerName: "Metalúrgica Alfa",
      description: "",
      orderDate: "",
      deliveryDate: "",
      items: [
        {
          family: "",
          parentItem: "",
          description: "Porta 1",
          quantity: 1,
          unitWeightKg: null,
          deliveryDate: "",
          op: "",
          processCodes: ["LASER"],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { items: { materials: unknown[] }[] }).items[0]?.materials).toEqual(
        [],
      );
    }
  });

  it("valida os materiais junto com o item (mensagem aponta o campo)", () => {
    const parsed = orderWithItemsSchema.safeParse({
      type: "OF",
      code: "OF-777",
      customerName: "Metalúrgica Alfa",
      description: "",
      orderDate: "",
      deliveryDate: "",
      items: [
        {
          family: "",
          parentItem: "",
          description: "Porta 1",
          quantity: 1,
          unitWeightKg: null,
          deliveryDate: "",
          op: "",
          processCodes: ["LASER"],
          materials: [{ description: "", quantity: 1, unit: "KG", notes: "" }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(messageOf(parsed)).toMatch(/Informe o material/);
  });
});
