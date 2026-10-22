import { z } from "zod";

import { ALLOWED_IMPORT_EXTENSIONS, IMPORT_DECISIONS, MAX_IMPORT_ROWS } from "@/lib/constants/import";
import {
  findMissingPartsColumns,
  findMissingProjectColumns,
  findMissingTechnicalColumns,
} from "@/lib/import/excel-parser";
import type { ImportSheetFormat } from "@/lib/types/import";
import { isValidISODate } from "@/lib/utils/dates";

/**
 * Validação de arquivo enviado para importação.
 * Nunca confiar no conteúdo do arquivo: extensão, tamanho e estrutura
 * são verificados antes de qualquer leitura.
 */
export function validateImportFile(file: File): { ok: true } | { ok: false; error: string } {
  const name = file.name ?? "";
  const extension = name.toLowerCase().slice(name.lastIndexOf("."));

  if (!(ALLOWED_IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, error: "Formato de arquivo não suportado. Envie .xlsx, .xls ou .pdf." };
  }

  if (file.size === 0) {
    return { ok: false, error: "O arquivo está vazio." };
  }

  return { ok: true };
}

/**
 * Limites defensivos da estrutura do arquivo: linhas/colunas e colunas
 * obrigatórias do FORMATO detectado — técnicas do layout da fábrica, da
 * lista de peças e conjuntos ou da lista de peças do projeto (sem elas,
 * o arquivo não é reconhecível).
 */
export function assertSheetStructure(
  headers: string[],
  rowCount: number,
  format: ImportSheetFormat = "layout-of",
): void {
  if (headers.length > 200) {
    throw new Error("A planilha possui colunas demais (máximo 200).");
  }
  if (rowCount === 0) {
    throw new Error("A planilha selecionada não contém linhas de dados.");
  }
  if (rowCount > MAX_IMPORT_ROWS) {
    throw new Error(`A planilha possui muitas linhas (máximo ${MAX_IMPORT_ROWS}).`);
  }

  const missing =
    format === "lista-pecas"
      ? findMissingPartsColumns(headers)
      : format === "lista-projeto"
        ? findMissingProjectColumns(headers)
        : findMissingTechnicalColumns(headers);
  if (missing.length > 0) {
    const hint =
      format === "lista-pecas"
        ? "A lista de peças precisa das colunas CONJUNTO, PEÇA, QTDE, PERFIL, MATERIAL e MASSA(Kg)."
        : format === "lista-projeto"
          ? "A lista de peças do projeto precisa das colunas GT/MD, PEÇA, CÓDIGO DA PEÇA, QUANTIDADE EM PROJETO e MASSA TOTAL DO PROJETO (KG)."
          : "O arquivo não está no formato esperado — use o modelo oficial.";
    throw new Error(`Colunas obrigatórias ausentes na planilha: ${missing.join(", ")}. ${hint}`);
  }
}

/**
 * Dados do formulário da importação: aba + cliente + data de entrega.
 * Cliente e entrega são digitados pelo operador e valem para TODOS os
 * registros do arquivo (a planilha não traz essas informações).
 */
export const importFormSchema = z.object({
  sheetName: z.string().min(1, "Selecione uma planilha"),
  customerName: z
    .string()
    .trim()
    .min(1, "Informe o nome do cliente.")
    .max(160, "O nome do cliente pode ter no máximo 160 caracteres."),
  deliveryDate: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isValidISODate(value), {
      message: "Informe uma data de entrega válida.",
    }),
});

export type ImportFormInput = z.infer<typeof importFormSchema>;

/** Decisões por OF existente escolhidas na prévia (etapa de execução). */
export const importDecisionsSchema = z.object({
  decisions: z.record(z.string(), z.enum(IMPORT_DECISIONS)),
});

export type ImportDecisionsInput = z.infer<typeof importDecisionsSchema>;
