import { z } from "zod";

import { MATERIAL_UNITS } from "@/lib/constants/materials";
import { decimalInput, nullableDate, nullableText, optionalDecimalInput } from "@/lib/validators/common";

/**
 * Item expedido no romaneio: item RAIZ da OF + quantidade desta carga
 * (expedição parcial — 0 = fora, validado no serviço contra a
 * pendência = qtd do item − Σ emitido em outros romaneios).
 */
export const romaneioItemSchema = z.object({
  orderItemId: z.string().trim().min(1, "Item inválido"),
  // Min 0 deixa o "0 = fora da carga" passar; o serviço exige > 0 para gravar.
  quantity: decimalInput("Quantidade", { min: 0 }),
});

/**
 * Linha de matéria-prima para a devolução (recebida do cliente −
 * utilizada na produção). `quantityPlanned` é o alocado do pedido
 * (informativo); received/used são informados pelo usuário (null =
 * ainda não informado — bloqueia a NF de devolução).
 */
export const romaneioMaterialSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Informe o material")
      .max(200, "Máximo de 200 caracteres"),
    unit: z.enum(MATERIAL_UNITS),
    quantityPlanned: optionalDecimalInput("Quantidade prevista"),
    quantityReceived: optionalDecimalInput("Quantidade recebida"),
    quantityUsed: optionalDecimalInput("Quantidade utilizada"),
  })
  .superRefine((material, ctx) => {
    if (
      material.quantityReceived !== null &&
      material.quantityUsed !== null &&
      material.quantityUsed > material.quantityReceived
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["quantityUsed"],
        message: "A quantidade utilizada não pode exceder a recebida",
      });
    }
  });

/**
 * Cabeçalho + itens + materiais de um romaneio em SIMULAÇÃO.
 * `id` presente = atualização de rascunho aberto; ausente = criação.
 */
export const romaneioSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    orderId: z.string().trim().min(1, "Selecione a OF"),
    shipmentDate: nullableDate,
    carrier: nullableText(200),
    vehicle: nullableText(100),
    notes: nullableText(1000),
    items: z.array(romaneioItemSchema).max(500, "Máximo de 500 itens por romaneio"),
    materials: z.array(romaneioMaterialSchema).max(200, "Máximo de 200 linhas de material"),
  })
  .superRefine((romaneio, ctx) => {
    const included = romaneio.items.filter((item) => item.quantity > 0);
    if (included.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Inclua ao menos um item no romaneio",
      });
      return;
    }
    const seen = new Set<string>();
    for (const [index, item] of included.entries()) {
      if (seen.has(item.orderItemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "orderItemId"],
          message: "Item repetido no romaneio",
        });
      }
      seen.add(item.orderItemId);
    }
  });

/** Números de NF registrados no romaneio (apoio à emissão externa). */
export const romaneioNfSchema = z
  .object({
    nfNumber: nullableText(60),
    returnNfNumber: nullableText(60),
  })
  .superRefine((value, ctx) => {
    if (value.returnNfNumber && !value.nfNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["nfNumber"],
        message: "Registre a NF de saída antes da NF de devolução",
      });
    }
  });

/** Aceite de conferência sinalizado na tela do romaneio (quem/quando/obs). */
export const romaneioConferenceSchema = z.object({
  notes: nullableText(500),
});

/** Payload digitado no formulário (quantidades ainda como texto/número). */
export type RomaneioInput = z.input<typeof romaneioSchema>;

/** Valores já convertidos (quantidades como número). */
export type RomaneioValues = z.output<typeof romaneioSchema>;
export type RomaneioItemValues = z.output<typeof romaneioItemSchema>;
export type RomaneioMaterialValues = z.output<typeof romaneioMaterialSchema>;
export type RomaneioNfValues = z.output<typeof romaneioNfSchema>;
