import { findMissingPartsColumns, normalizeHeader } from "@/lib/import/excel-parser";
import {
  cellNumber,
  cellText,
  familyFromDescription,
  isEmptyRow,
  materialDescription,
} from "@/lib/import/of-structure";
import type { BuiltOf, FileChild, FileParent, ParsedSheet, StructureIssue } from "@/lib/types/import";
import { calculateTotalWeight, formatWeight, toNumber } from "@/lib/utils/formatting";
import { orderCodeFromDateAndFileKey } from "@/lib/utils/order-code";

/**
 * Construção da estrutura a partir da LISTA DE PEÇAS E CONJUNTOS de
 * cliente (038) — 7 colunas e linhas agrupadas:
 *
 *   CONJUNTO | PEÇA | QTDE | PERFIL | MATERIAL | COMPR.(mm) | MASSA(Kg)
 *
 *   * linha-mãe (CONJUNTO com nome, PEÇA vazia): vira ITEM PAI — a
 *     coluna PERFIL traz o TIPO DO PRODUTO (ex.: GUARDA-CORPO) e a
 *     MASSA o peso TOTAL do conjunto;
 *   * linhas logo abaixo (CONJUNTO = "#"): itens FILHOS — PEÇA é o
 *     código do filho, QTDE a quantidade POR CONJUNTO, PERFIL a
 *     MATÉRIA-PRIMA relacionada (ex.: BARRA22X3.2, mesmo papel do
 *     cp_DesMaterial do layout da fábrica), MATERIAL a qualidade do aço
 *     (A36, DIN 2440) e MASSA o peso UNITÁRIO do filho;
 *   * COMPR.(mm) entra nas observações da matéria-prima.
 *
 * O código da OF NÃO vem do arquivo: é gerado com
 * `orderCodeFromDateAndFileKey` (data de entrega + sufixo derivado dos
 * bytes do arquivo — "2026-11-05" vira "OF 0511-XXXX"), a MESMA
 * estratégia da lista de peças do projeto: dois clientes com a MESMA
 * entrega ficam em OFs distintas e a reimportação continua
 * determinística (mesmo arquivo + mesma entrega = mesmo código = decisão
 * da prévia em vez de OF nova). Cliente e data continuam vindo do
 * formulário, como nos demais formatos.
 *
 * Pesos: o peso unitário do pai = massa de UM conjunto (Σ filho unit ×
 * qtd) e o total = qtd × unit (023 — o banco recalcula por trigger). A
 * MASSA da linha-mãe só serve para AVISAR quando diverge da fórmula
 * (tolerância de 0,5%: a lista arredonda a massa para 1 casa).
 */

/** Cliente + data digitados no formulário da importação. */
export interface PartsStructureFormInput {
  customerName: string;
  deliveryDate: string;
}

/** Índice coluna (normalizada) -> posição na planilha (primeira ocorrência). */
type ColumnIndex = Partial<
  Record<
    "CONJUNTO" | "PECA" | "QTDE" | "PERFIL" | "MATERIAL" | "COMPRMM" | "MASSAKG",
    number
  >
>;

/** Colunas lidas — as 7 da lista (demais são ignoradas). */
const CONSUMED_COLUMNS = [
  "CONJUNTO",
  "PECA",
  "QTDE",
  "PERFIL",
  "MATERIAL",
  "COMPRMM",
  "MASSAKG",
] as const;

/**
 * Tolerância da divergência de peso da linha-mãe: 0,001 kg OU 0,5% do
 * valor da lista — a massa do arquivo sai com 1 casa decimal (erros
 * observados no arquivo real ≤ 0,1%), então só avisa quando a lista
 * parece desatualizada.
 */
function isWeightDivergent(spreadsheet: number, derived: number): boolean {
  if (Math.abs(spreadsheet - derived) < 0.001) return false;
  return Math.abs(spreadsheet - derived) / Math.max(Math.abs(spreadsheet), 1e-9) > 0.005;
}

function issue(partial: StructureIssue): StructureIssue {
  return partial;
}

/**
 * Monta a estrutura OF única (código gerado da entrega + sufixo do
 * arquivo) -> conjuntos como itens pai -> peças como filhos ->
 * matéria-prima. Lança erro quando faltam colunas obrigatórias ou a
 * data de entrega é inválida.
 */
export function buildPartsOfStructure(
  sheet: ParsedSheet,
  form: PartsStructureFormInput,
  fileKey: string,
): { orders: BuiltOf[]; ignoredColumns: string[] } {
  const missing = findMissingPartsColumns(sheet.headers);
  if (missing.length > 0) {
    throw new Error(
      `Colunas obrigatórias ausentes na lista: ${missing.join(", ")}. Esperado: CONJUNTO, PEÇA e QTDE.`,
    );
  }

  const col: ColumnIndex = {};
  sheet.headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !(key in col)) col[key as keyof ColumnIndex] = index;
  });

  const { code, type } = orderCodeFromDateAndFileKey(form.deliveryDate, fileKey);
  const order: BuiltOf = {
    code,
    type,
    customerName: form.customerName,
    description: "",
    deliveryDate: form.deliveryDate,
    parents: [],
    sourceRow: sheet.headerRowIndex + 2,
    issues: [],
  };

  /** MASSA da linha-mãe por conjunto (só para o aviso de divergência). */
  const spreadsheetTotals = new Map<string, { value: number | null; raw: string }>();
  /** Peças já vistas por conjunto (repetida -> a primeira é mantida). */
  const seenChildren = new Map<string, Set<string>>();

  sheet.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const excelRow = sheet.headerRowIndex + index + 2;
    const conjunto = cellText(row, col.CONJUNTO);
    const peca = cellText(row, col.PECA);

    // -------------------------------------------------------
    // Linha-mãe (CONJUNTO com nome, PEÇA vazia) -> item pai
    // -------------------------------------------------------
    if (conjunto !== "" && conjunto !== "#" && peca === "") {
      if (order.parents.some((entry) => entry.code === conjunto)) {
        order.issues.push(
          issue({
            type: "DUPLICATE",
            severity: "warning",
            where: conjunto,
            column: "CONJUNTO",
            message: "Conjunto repetido na lista — a primeira ocorrência foi mantida.",
            rawValue: conjunto,
          }),
        );
        return;
      }

      const quantity = cellNumber(row, col.QTDE);
      const totalSpreadsheet = cellNumber(row, col.MASSAKG);
      const description = cellText(row, col.PERFIL); // tipo do produto

      const parent: FileParent = {
        code: conjunto,
        description,
        family: familyFromDescription(description),
        quantity: quantity.value ?? 0,
        unitWeightKg: null,
        totalWeightKg: null,
        deliveryDate: form.deliveryDate,
        materials: [],
        children: [],
      };
      order.parents.push(parent);
      if (order.parents.length === 1) order.sourceRow = excelRow;
      spreadsheetTotals.set(conjunto, totalSpreadsheet);
      if (!order.description && description) order.description = description;

      if (quantity.raw && quantity.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: conjunto,
            column: "QTDE",
            message: `Quantidade inválida ignorada: "${quantity.raw}".`,
            rawValue: quantity.raw,
          }),
        );
      }
      if (totalSpreadsheet.raw && totalSpreadsheet.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: conjunto,
            column: "MASSA(Kg)",
            message: `Peso total inválido ignorado: "${totalSpreadsheet.raw}".`,
            rawValue: totalSpreadsheet.raw,
          }),
        );
      }
      return;
    }

    // -------------------------------------------------------
    // Linha de peça (PEÇA presente, CONJUNTO "#" ou vazio)
    // -------------------------------------------------------
    if (peca !== "" && (conjunto === "" || conjunto === "#")) {
      const parent = order.parents[order.parents.length - 1];
      if (!parent) {
        order.issues.push(
          issue({
            type: "REQUIRED",
            severity: "error",
            where: `Linha ${excelRow}`,
            column: "PEÇA",
            message: "Linha de peça sem conjunto acima — ignorada.",
            rawValue: peca,
          }),
        );
        return;
      }

      let seen = seenChildren.get(parent.code);
      if (!seen) {
        seen = new Set<string>();
        seenChildren.set(parent.code, seen);
      }
      if (seen.has(peca)) {
        order.issues.push(
          issue({
            type: "DUPLICATE",
            severity: "warning",
            where: `${parent.code} / ${peca}`,
            column: "PEÇA",
            message: "Peça repetida no conjunto — a primeira ocorrência foi mantida.",
            rawValue: peca,
          }),
        );
        return;
      }
      seen.add(peca);

      const perfil = cellText(row, col.PERFIL); // matéria-prima do filho
      const quantity = cellNumber(row, col.QTDE);
      const unitWeight = cellNumber(row, col.MASSAKG);
      const child: FileChild = {
        code: peca,
        // Sem PERFIL, a descrição cai para o próprio código (regra do layout).
        description: perfil || peca,
        family: familyFromDescription(perfil),
        quantity: quantity.value ?? 0,
        unitWeightKg: unitWeight.value,
        totalWeightKg: calculateTotalWeight(quantity.value ?? 0, unitWeight.value),
        deliveryDate: form.deliveryDate,
        materials: [],
      };

      const material = materialDescription(perfil);
      if (material) {
        const quality = cellText(row, col.MATERIAL);
        const rawLength = cellText(row, col.COMPRMM);
        const notes = [quality, rawLength ? `${rawLength} mm` : ""].filter(Boolean).join(" · ");
        child.materials.push({
          description: material,
          quantity: quantity.value ?? 0,
          unit: "UN",
          notes: notes || null,
        });
      } else {
        order.issues.push(
          issue({
            type: "REQUIRED",
            severity: "warning",
            where: `${parent.code} / ${peca}`,
            column: "PERFIL",
            message: "Item filho sem matéria-prima informada.",
            rawValue: perfil || null,
          }),
        );
      }

      if (quantity.raw && quantity.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: `${parent.code} / ${peca}`,
            column: "QTDE",
            message: `Quantidade inválida ignorada: "${quantity.raw}".`,
            rawValue: quantity.raw,
          }),
        );
      }
      if (unitWeight.raw && unitWeight.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: `${parent.code} / ${peca}`,
            column: "MASSA(Kg)",
            message: `Peso unitário inválido ignorado: "${unitWeight.raw}".`,
            rawValue: unitWeight.raw,
          }),
        );
      }
      const rawLength = cellText(row, col.COMPRMM);
      if (rawLength && toNumber(rawLength) === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: `${parent.code} / ${peca}`,
            column: "COMPR.(mm)",
            message: `Comprimento inválido ignorado: "${rawLength}".`,
            rawValue: rawLength,
          }),
        );
      }

      parent.children.push(child);
      return;
    }

    // -------------------------------------------------------
    // Linha não reconhecida (sem conjunto e sem peça, ou com
    // os dois preenchidos) — registrada e ignorada.
    // -------------------------------------------------------
    order.issues.push(
      issue({
        type: "REQUIRED",
        severity: "error",
        where: `Linha ${excelRow}`,
        column: "CONJUNTO",
        message: "Linha sem identificação válida de conjunto/peça — ignorada.",
        rawValue: conjunto || peca || null,
      }),
    );
  });

  // -------------------------------------------------------
  // Pesos do pai + validação da estrutura montada
  // -------------------------------------------------------
  for (const parent of order.parents) {
    if (parent.children.length === 0) {
      order.issues.push(
        issue({
          type: "STRUCTURE",
          severity: "warning",
          where: parent.code,
          column: "PEÇA",
          message: "Conjunto sem itens filhos — nada a fabricar nele.",
          rawValue: null,
        }),
      );
    }

    // Peso unitário = massa de UM conjunto (Σ filho unit × qtd); o total
    // é qtd × unit (023) e a MASSA da lista só vira aviso de divergência.
    const setMass = parent.children.reduce(
      (sum, child) => sum + (child.unitWeightKg ?? 0) * child.quantity,
      0,
    );
    if (parent.children.length > 0 && setMass > 0) {
      const totalWeightKg = calculateTotalWeight(parent.quantity, setMass);
      parent.unitWeightKg = setMass;
      parent.totalWeightKg = totalWeightKg;

      const spreadsheet = spreadsheetTotals.get(parent.code);
      if (
        spreadsheet &&
        spreadsheet.value !== null &&
        totalWeightKg !== null &&
        isWeightDivergent(spreadsheet.value, totalWeightKg)
      ) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: parent.code,
            column: "MASSA(Kg)",
            message:
              `Peso total da lista (${formatWeight(spreadsheet.value)}) difere de ` +
              `quantidade × peso unitário (${formatWeight(totalWeightKg)}) — o sistema grava a fórmula.`,
            rawValue: spreadsheet.raw,
          }),
        );
      }
    }

    if (!parent.description) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "warning",
          where: parent.code,
          column: "PERFIL",
          message: "Conjunto sem tipo do produto (PERFIL) na linha do conjunto.",
          rawValue: null,
        }),
      );
    }
    if (parent.quantity <= 0) {
      order.issues.push(
        issue({
          type: "NUMBER",
          severity: "error",
          where: parent.code,
          column: "QTDE",
          message: "Quantidade do item pai ausente ou inválida (QTDE).",
          rawValue: null,
        }),
      );
    }
    for (const child of parent.children) {
      if (child.quantity <= 0) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "error",
            where: `${parent.code} / ${child.code}`,
            column: "QTDE",
            message: "Quantidade do item filho ausente ou inválida (QTDE).",
            rawValue: null,
          }),
        );
      }
    }
  }

  if (order.parents.length === 0 && !order.issues.some((entry) => entry.severity === "error")) {
    order.issues.push(
      issue({
        type: "STRUCTURE",
        severity: "error",
        where: order.code,
        column: "CONJUNTO",
        message: "Lista sem conjuntos válidos — nada a importar.",
        rawValue: null,
      }),
    );
  }

  const consumed = new Set(CONSUMED_COLUMNS.map(normalizeHeader));
  const ignoredColumns = sheet.headers.filter(
    (header) => header.trim() !== "" && !consumed.has(normalizeHeader(header)),
  );

  return { orders: [order], ignoredColumns };
}
