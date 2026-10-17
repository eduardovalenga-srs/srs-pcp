import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  BuiltOf,
  FileOrder,
  ImportErrorEntry,
  ImportPreview,
  ImportSheetFormat,
  OfDecisionMap,
  OfPreview,
} from "@/lib/types/import";
import { findOrderStructures } from "@/lib/repositories/orders.repository";
import {
  applyOfPlan,
  completeBatch,
  createBatch,
  insertBatchErrors,
} from "@/lib/repositories/import.repository";
import { parseExcelFile } from "@/lib/import/excel-parser";
import { buildOfStructure, orderStatusOf } from "@/lib/import/of-structure";
import { buildPartsOfStructure } from "@/lib/import/of-structure-parts";
import { buildOfFromPdfRows, PDF_COMPOSITION_SHEET_NAME } from "@/lib/import/of-pdf";
import { extractPdfRows } from "@/lib/import/pdf-text";
import { buildOfImportPlan, computeOfDifferences } from "@/lib/import/of-plan";
import type { OfImportPlan } from "@/lib/import/of-plan";
import { getImportMaxFileSize } from "@/lib/env";
import { ALLOWED_IMPORT_EXTENSIONS, PDF_IMPORT_EXTENSION } from "@/lib/constants/import";
import { assertSheetStructure, validateImportFile } from "@/lib/validators/import.schema";
import type { Json } from "@/lib/types/database";
import { errorMessage } from "@/lib/utils/supabase-result";

/**
 * Erro de ENTRADA (arquivo/aba/formulário/decisões): a API responde 400.
 * Diferente de falha de gravação/RPC (500), nunca deixa lote parcial —
 * acontece antes de qualquer escrita.
 */
export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportInputError";
  }
}

/**
 * Serviço da importação do layout novo (estrutura OF).
 *
 * O arquivo traz a árvore OF -> itens pai -> filhos -> matéria-prima;
 * cliente e data de entrega vêm do formulário e valem para todos os
 * registros. Não existe etapa de mapeamento: as colunas são reconhecidas
 * pelo NOME técnico e os processos são criados pelo catálogo (o arquivo
 * não traz status de processo nem OP).
 *
 * Três fontes, o MESMO downstream: planilha da fábrica (.xlsx/.xls,
 * colunas técnicas), lista de peças e conjuntos de cliente (038, colunas
 * CONJUNTO/PEÇA/...) e PDF da A1 (.pdf, seção "COMPOSIÇÃO DOS
 * CONJUNTOS"). Todas produzem `BuiltOf` — prévia, diffs, decisões,
 * plano e RPC não mudam conforme a origem.
 */

export interface AnalyzeOutput {
  fileName: string;
  fileSize: number;
  /** Origem do arquivo: planilha Excel ou PDF da A1 (seção de composição). */
  source: "excel" | "pdf";
  /** Abas (Excel) ou a seção reconhecida do PDF, no formato reconhecido. */
  sheets: { name: string; rowCount: number; columnCount: number; format: ImportSheetFormat | null }[];
  defaultSheet: string;
}

/** O arquivo é um PDF da A1 (Ordem de Fabricação)? */
export function isPdfImport(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(PDF_IMPORT_EXTENSION);
}

/** Lê o arquivo validando extensão e tamanho (20 MB por padrão). */
export async function readFileForImport(file: File): Promise<{ buffer: ArrayBuffer; fileName: string; fileSize: number }> {
  const validation = validateImportFile(file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const maxFileSize = getImportMaxFileSize();
  if (file.size > maxFileSize) {
    const limitMb = Math.round(maxFileSize / (1024 * 1024));
    throw new Error(`Arquivo muito grande. O limite é de ${limitMb} MB.`);
  }

  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!(ALLOWED_IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error("Formato de arquivo não suportado. Envie .xlsx, .xls ou .pdf.");
  }

  const buffer = await file.arrayBuffer();
  return { buffer, fileName: file.name, fileSize: file.size };
}

/** Etapa 1 (Excel): lê o arquivo e identifica as abas no formato esperado. */
export function analyzeWorkbook(buffer: ArrayBuffer, fileName: string, fileSize: number): AnalyzeOutput {
  const workbook = parseExcelFile(buffer, fileName, fileSize);
  const importable = workbook.sheets.filter((sheet) => workbook.headerBySheet[sheet.name]?.detected);

  if (importable.length === 0) {
    throw new Error(
      'O arquivo não contém nenhuma aba no formato reconhecido — planilha da fábrica (colunas técnicas "of_idOF" e "ps_idPos") ou lista de peças e conjuntos (colunas "CONJUNTO", "PEÇA" e "QTDE").',
    );
  }

  const first = importable[0];
  if (!first) return { fileName, fileSize, source: "excel", sheets: [], defaultSheet: "" };
  assertSheetStructure(first.headers, first.rows.length, workbook.headerBySheet[first.name]?.format ?? "layout-of");

  return {
    fileName,
    fileSize,
    source: "excel",
    sheets: importable.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rows.length,
      columnCount: sheet.headers.filter((header) => header.trim() !== "").length,
      format: workbook.headerBySheet[sheet.name]?.format ?? null,
    })),
    defaultSheet: first.name,
  };
}

/** Etapa 1 (PDF): identifica a seção de composição e conta os conjuntos. */
export async function analyzePdf(buffer: ArrayBuffer, fileName: string, fileSize: number): Promise<AnalyzeOutput> {
  try {
    const rows = await extractPdfRows(buffer);
    const { orders } = buildOfFromPdfRows(rows, { customerName: "", deliveryDate: "" });
    const parents = orders.reduce((total, order) => total + order.parents.length, 0);

    return {
      fileName,
      fileSize,
      source: "pdf",
      sheets: [
        {
          name: PDF_COMPOSITION_SHEET_NAME,
          rowCount: parents,
          // Campos lidos por linha de composição (cabeçalho/filho/material).
          columnCount: 9,
          // O PDF não tem cabeçalho de planilha: formato não se aplica.
          format: null,
        },
      ],
      defaultSheet: PDF_COMPOSITION_SHEET_NAME,
    };
  } catch (error) {
    // PDF ilegível/sem seção esperada: entrada, não falha do sistema.
    throw new Error(errorMessage(error, "Não foi possível processar o PDF."));
  }
}

/** Etapa 1: despacha pela extensão (.pdf -> PDF da A1; senão -> Excel). */
export async function analyzeImportFile(
  buffer: ArrayBuffer,
  fileName: string,
  fileSize: number,
): Promise<AnalyzeOutput> {
  if (isPdfImport(fileName)) return analyzePdf(buffer, fileName, fileSize);
  return analyzeWorkbook(buffer, fileName, fileSize);
}

export interface PreviewInput {
  buffer: ArrayBuffer;
  fileName: string;
  fileSize: number;
  sheetName: string;
  customerName: string;
  deliveryDate: string;
}

/**
 * Etapa 2: monta a estrutura hierárquica, valida e compara com o que já
 * existe no banco (diferenças campo a campo por OF).
 */
export async function buildPreview(client: SupabaseServer, input: PreviewInput): Promise<ImportPreview> {
  let orders: BuiltOf[];
  let ignoredColumns: string[];
  try {
    if (isPdfImport(input.fileName)) {
      // PDF da A1: seção "COMPOSIÇÃO DOS CONJUNTOS" -> mesma árvore.
      const rows = await extractPdfRows(input.buffer);
      const built = buildOfFromPdfRows(rows, {
        customerName: input.customerName,
        deliveryDate: input.deliveryDate,
      });
      orders = built.orders;
      // Sem "colunas" no PDF: a seção inteira é consumida.
      ignoredColumns = [];
    } else {
      const workbook = parseExcelFile(input.buffer, input.fileName, input.fileSize);
      const sheet = workbook.sheets.find((entry) => entry.name === input.sheetName);
      if (!sheet) throw new Error(`Planilha "${input.sheetName}" não encontrada.`);

      const detection = workbook.headerBySheet[sheet.name];
      if (!detection?.detected || !detection.format) {
        throw new Error(
          `A aba "${input.sheetName}" não tem o cabeçalho reconhecido (layout da fábrica ou lista de peças e conjuntos).`,
        );
      }
      assertSheetStructure(sheet.headers, sheet.rows.length, detection.format);

      const built =
        detection.format === "lista-pecas"
          ? buildPartsOfStructure(sheet, {
              customerName: input.customerName,
              deliveryDate: input.deliveryDate,
            })
          : buildOfStructure(sheet, {
              customerName: input.customerName,
              deliveryDate: input.deliveryDate,
            });
      orders = built.orders;
      ignoredColumns = built.ignoredColumns;
    }
  } catch (error) {
    // Arquivo/aba/estrutura inválidos: entrada, não falha do sistema.
    throw new ImportInputError(errorMessage(error, "Não foi possível processar o arquivo."));
  }

  const codes = [...new Set(orders.map((order) => order.code))];
  const existing = await findOrderStructures(client, codes);

  const previews: OfPreview[] = orders.map((order) => {
    const structure = existing.get(order.code.toUpperCase()) ?? null;
    const { sourceRow, issues, ...fileOrder } = order;
    return {
      order: fileOrder as FileOrder,
      sourceRow,
      status: orderStatusOf(issues),
      issues,
      exists: structure !== null,
      existingStatus: structure?.status ?? null,
      differences: computeOfDifferences(order, structure),
      counts: {
        parents: order.parents.length,
        children: order.parents.reduce((total, parent) => total + parent.children.length, 0),
        materials:
          order.parents.reduce(
            (total, parent) =>
              total + parent.materials.length + parent.children.reduce((sum, child) => sum + child.materials.length, 0),
            0,
          ),
      },
      requiresDecision: structure !== null && orderStatusOf(issues) !== "ERROR",
    };
  });

  const totals = {
    orders: previews.length,
    importable: previews.filter((entry) => entry.status !== "ERROR").length,
    existing: previews.filter((entry) => entry.requiresDecision).length,
    errors: previews.filter((entry) => entry.status === "ERROR").length,
    warnings: previews.filter((entry) => entry.status === "WARNING").length,
    parents: previews.reduce((total, entry) => total + entry.counts.parents, 0),
    children: previews.reduce((total, entry) => total + entry.counts.children, 0),
    materials: previews.reduce((total, entry) => total + entry.counts.materials, 0),
  };

  return {
    fileName: input.fileName,
    sheetName: input.sheetName,
    customerName: input.customerName,
    deliveryDate: input.deliveryDate,
    orders: previews,
    totals,
    ignoredColumns,
  };
}

export interface ExecuteImportInput extends PreviewInput {
  decisions: OfDecisionMap;
}

export interface ExecuteImportOutput {
  batchId: string;
  /** OFs no arquivo. */
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: number;
  parentsCreated: number;
  parentsUpdated: number;
  childrenCreated: number;
  childrenUpdated: number;
  itemsRemoved: number;
}

/** Erros do lote: uma entrada por ocorrência das OFs com ERRO. */
function errorEntries(preview: ImportPreview): ImportErrorEntry[] {
  return preview.orders
    .filter((entry) => entry.status === "ERROR")
    .flatMap((entry) =>
      entry.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => ({
          rowNumber: entry.sourceRow,
          columnName: issue.column,
          errorType: issue.type,
          message: issue.where.startsWith("Linha") ? issue.message : `${issue.where} — ${issue.message}`,
          rawValue: issue.rawValue,
        })),
    );
}

/**
 * Etapa 3: executa a importação.
 *
 * Fluxo transacional: prévia -> plano (com decisões por OF) -> gravar
 * (RPC única) -> registrar lote + erros. Em caso de falha, o rollback é
 * automático e o lote é marcado como FALHOU.
 */
export async function executeImport(
  client: SupabaseServer,
  sessionUser: SessionUser,
  input: ExecuteImportInput,
): Promise<ExecuteImportOutput> {
  const preview = await buildPreview(client, input);

  let plan: OfImportPlan;
  try {
    plan = buildOfImportPlan(preview, input.decisions);
  } catch (error) {
    // Decisões ausentes/inválidas: entrada do usuário, não falha de gravação.
    throw new ImportInputError(errorMessage(error, "Decisões de importação inválidas."));
  }

  const batchId = await createBatch(client, {
    fileName: input.fileName,
    fileSize: input.fileSize,
    totalRows: preview.totals.orders,
    validRows: preview.totals.importable,
    errorRows: preview.totals.errors,
    warningRows: preview.totals.warnings,
    createdBy: sessionUser.id,
  });

  await insertBatchErrors(client, batchId, errorEntries(preview));

  try {
    const result = await applyOfPlan(client, { operations: plan.operations } as unknown as Json);

    const written = result.ordersCreated + result.ordersUpdated;
    await completeBatch(client, batchId, {
      status: preview.totals.errors > 0 ? "COM_ERROS" : "CONCLUIDO",
      validRows: written,
    });

    return {
      batchId,
      total: preview.totals.orders,
      created: result.ordersCreated,
      updated: result.ordersUpdated,
      skipped: result.ordersSkipped,
      errors: preview.totals.errors,
      warnings: preview.totals.warnings,
      parentsCreated: result.parentsCreated,
      parentsUpdated: result.parentsUpdated,
      childrenCreated: result.childrenCreated,
      childrenUpdated: result.childrenUpdated,
      itemsRemoved: result.itemsRemoved,
    };
  } catch (error) {
    await completeBatch(client, batchId, { status: "FALHOU", validRows: 0 }).catch(() => undefined);
    throw error;
  }
}
