import { z } from "zod";

import { decimalInput } from "@/lib/validators/common";
import { PROCESS_FACTORIES } from "@/lib/validators/process.schema";

export const PRODUCT_CAPACITY_UNITS = ["KG", "M2", "UNIDADES"] as const;
export type ProductCapacityUnit = (typeof PRODUCT_CAPACITY_UNITS)[number];

const productGroupCapacitySchema = z.object({
  factory: z.enum(PROCESS_FACTORIES),
  processId: z.string().uuid("Processo inválido"),
  unit: z.enum(PRODUCT_CAPACITY_UNITS),
  capacity: decimalInput("Capacidade"),
});

export const saveProductGroupSchema = z
  .object({
    id: z.number().int().positive().nullable().optional(),
    familyDescription: z
      .string()
      .trim()
      .min(1, "Informe a descrição da família")
      .max(120, "Máximo de 120 caracteres"),
    familyAbbreviation: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, "Informe a abreviação da família")
      .max(3, "A abreviação deve ter no máximo 3 caracteres")
      .regex(/^[A-Z0-9]{1,3}$/, "Use de 1 a 3 letras ou números"),
    capacities: z
      .array(productGroupCapacitySchema)
      .min(1, "Informe as capacidades dos processos"),
  })
  .superRefine(({ capacities }, ctx) => {
    const keys = new Set<string>();
    capacities.forEach((capacity, index) => {
      const key = `${capacity.factory}:${capacity.processId}:${capacity.unit}`;
      if (keys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["capacities", index, "unit"],
          message: "Unidade repetida para este processo e fábrica",
        });
      }
      keys.add(key);
    });
  });

export type SaveProductGroupInput = z.input<typeof saveProductGroupSchema>;
export type SaveProductGroupOutput = z.output<typeof saveProductGroupSchema>;
