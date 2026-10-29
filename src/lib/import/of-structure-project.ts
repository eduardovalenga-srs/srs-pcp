import { findMissingProjectColumns, normalizeHeader } from "@/lib/import/excel-parser";
import {
  cellNumber,
  cellText,
  familyFromDescription,
  isEmptyRow,
  materialDescription,
} from "@/lib/import/of-structure";
import type { BuiltOf, FileChild, ParsedSheet, StructureIssue } from "@/lib/types/import";
import { calculateTotalWeight } from "@/lib/utils/formatting";
import { orderCodeFromFileName } from "@/lib/utils/order-code";

/**
 * Construção da estrutura a partir da LISTA DE PEÇAS DO PROJETO
 * (arquivos TUCUMANN GC GERAL) — 6 colunas, uma linha POR PEÇA:
 *
 *   GT/MD | PEÇA | CÓDIGO DA PEÇA | PEÇA PRINCIPAL | QUANTIDADE EM PROJETO | MASSA TOTAL DO PROJETO (KG)
 *
 *   * cada VALOR distinto de GT/MD é um CONJUNTO (escada/torre) e vira
 *     ITEM PAI — a coluna PEÇA traz o TIPO DO PRODUTO (ex.:
 *     "GUARDA CORPO") e o pai tem quantidade 1;
 *   * cada linha vira um ITEM FILHO — CÓDIGO DA PEÇA é o código, PEÇA a
 *     descrição, QUANTIDADE EM PROJETO a quantidade e a MASSA TOTAL ÷
 *     QUANTIDADE o peso UNITÁRIO do filho;
 *   * PEÇA PRINCIPAL é a MATÉRIA-PRIMA do filho (ex.: TB.RED.DN32_DIN,
 *     CH4.8X200) — mesma função do cp_DesMaterial do layout da fábrica;
 *     entra com a quantidade do filho e unidade "UN".
 *
 * O código da OF NÃO vem do arquivo (nem o cliente/entrega): é gerado do
 * NOME DO ARQUIVO sem a extensão (`orderCodeFromFileName` — "GC-GERAL.xlsx"
 * vira "OF GC-GERAL"), a MESMA estratégia da lista de peças e conjuntos:
 * a reimportação do mesmo arquivo continua determinística (mesmo código =
 * decisão da prévia em vez de OF nova).
 *
 * Pesos: o peso unitário do pai = massa de UM torre (Σ filho unit ×
 * qtd) e o total = qtd × unit (023 — o banco recalcula por trigger).
 */

/** Cliente + data digitados no formulário da importação. */
export interface ProjectStructureFormInput {
  customerName: string;
  deliveryDate: string;
}

/** Índice coluna (normalizada) -> posição na planilha (primeira ocorrência). */
type ColumnIndex = Partial<
  Record<
    "GTMD" | "PECA" | "CODIGODAPECA" | "PECAPRINCIPAL" | "QUANTIDADEEMPROJETO" | "MASSATOTALDOPROJETOKG",
    number
  >
>;

/** Colunas lidas — as 6 da lista (demais são ignoradas). */
const CONSUMED_COLUMNS = [
  "GTMD",
  "PECA",
  "CODIGODAPECA",
  "PECAPRINCIPAL",
  "QUANTIDADEEMPROJETO",
  "MASSATOTALDOPROJETOKG",
] as const;

function issue(partial: StructureIssue): StructureIssue {
  return partial;
}

/**
 * Monta a estrutura OF única (código gerado do nome do arquivo) -> grupos
 * GT/MD como itens pai -> peças como filhos -> matéria-prima. Lança erro
 * quando faltam colunas obrigatórias ou o nome do arquivo não gera código.
 */
export function buildProjectOfStructure(
  sheet: ParsedSheet,
  form: ProjectStructureFormInput,
  fileName: string,
): { orders: BuiltOf[]; ignoredColumns: string[] } {
  const missing = findMissingProjectColumns(sheet.headers);
  if (missing.length > 0) {
    throw new Error(
      `Colunas obrigatórias ausentes na lista do projeto: ${missing.join(", ")}. ` +
        "Esperado: GT/MD, PEÇA, CÓDIGO DA PEÇA e QUANTIDADE EM PROJETO.",
    );
  }

  const col: ColumnIndex = {};
  sheet.headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !(key in col)) col[key as keyof ColumnIndex] = index;
  });

  const { code, type } = orderCodeFromFileName(fileName);
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

  /** Códigos de peça já vistos por grupo (repetida -> a primeira é mantida). */
  const seenChildren = new Map<string, Set<string>>();

  sheet.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const excelRow = sheet.headerRowIndex + index + 2;
    const group = cellText(row, col.GTMD);
    const peca = cellText(row, col.CODIGODAPECA);

    if (!group) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "error",
          where: `Linha ${excelRow}`,
          column: "GT/MD",
          message: "Linha sem grupo (GT/MD) — ignorada.",
          rawValue: peca || null,
        }),
      );
      return;
    }
    if (!peca) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "error",
          where: `Linha ${excelRow}`,
          column: "CÓDIGO DA PEÇA",
          message: "Linha sem código de peça (CÓDIGO DA PEÇA) — ignorada.",
          rawValue: group,
        }),
      );
      return;
    }

    // -------------------------------------------------------
    // Grupo GT/MD -> item pai (primeira ocorrência); a PEÇA da
    // linha é o TIPO DO PRODUTO e completa o pai ainda vazio.
    // -------------------------------------------------------
    const description = cellText(row, col.PECA);
    let parent = order.parents.find((entry) => entry.code === group);
    if (!parent) {
      parent = {
        code: group,
        description,
        family: familyFromDescription(description),
        quantity: 1,
        unitWeightKg: null,
        totalWeightKg: null,
        deliveryDate: form.deliveryDate,
        materials: [],
        children: [],
      };
      order.parents.push(parent);
      if (order.parents.length === 1) order.sourceRow = excelRow;
      if (!order.description && description) order.description = description;
    } else if (!parent.description && description) {
      parent.description = description;
      parent.family = familyFromDescription(description);
      if (!order.description) order.description = description;
    }

    // -------------------------------------------------------
    // Linha de peça -> item filho
    // -------------------------------------------------------
    let seen = seenChildren.get(group);
    if (!seen) {
      seen = new Set<string>();
      seenChildren.set(group, seen);
    }
    if (seen.has(peca)) {
      order.issues.push(
        issue({
          type: "DUPLICATE",
          severity: "warning",
          where: `${group} / ${peca}`,
          column: "CÓDIGO DA PEÇA",
          message: "Peça repetida no grupo — a primeira ocorrência foi mantida.",
          rawValue: peca,
        }),
      );
      return;
    }
    seen.add(peca);

    const quantity = cellNumber(row, col.QUANTIDADEEMPROJETO);
    const totalWeight = cellNumber(row, col.MASSATOTALDOPROJETOKG);
    // Peso unitário = massa total ÷ quantidade do projeto.
    const unitWeightKg =
      totalWeight.value !== null && quantity.value ? totalWeight.value / quantity.value : null;
    const child: FileChild = {
      code: peca,
      // Sem PEÇA, a descrição cai para o próprio código (regra do layout).
      description: description || peca,
      family: familyFromDescription(description),
      quantity: quantity.value ?? 0,
      unitWeightKg,
      totalWeightKg: calculateTotalWeight(quantity.value ?? 0, unitWeightKg),
      deliveryDate: form.deliveryDate,
      materials: [],
    };

    const rawProfile = cellText(row, col.PECAPRINCIPAL);
    const material = materialDescription(rawProfile);
    if (material) {
      child.materials.push({
        description: material,
        quantity: quantity.value ?? 0,
        unit: "UN",
        notes: null,
      });
    } else {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "warning",
          where: `${group} / ${peca}`,
          column: "PEÇA PRINCIPAL",
          message: "Item filho sem matéria-prima informada.",
          rawValue: rawProfile || null,
        }),
      );
    }

    if (quantity.raw && quantity.value === null) {
      order.issues.push(
        issue({
          type: "NUMBER",
          severity: "warning",
          where: `${group} / ${peca}`,
          column: "QUANTIDADE EM PROJETO",
          message: `Quantidade inválida ignorada: "${quantity.raw}".`,
          rawValue: quantity.raw,
        }),
      );
    }
    if (totalWeight.raw && totalWeight.value === null) {
      order.issues.push(
        issue({
          type: "NUMBER",
          severity: "warning",
          where: `${group} / ${peca}`,
          column: "MASSA TOTAL DO PROJETO (KG)",
          message: `Peso total inválido ignorado: "${totalWeight.raw}".`,
          rawValue: totalWeight.raw,
        }),
      );
    }

    parent.children.push(child);
  });

  // -------------------------------------------------------
  // Pesos do pai + validação da estrutura montada
  // -------------------------------------------------------
  for (const parent of order.parents) {
    // Peso unitário = massa de UM torre (Σ filho unit × qtd); o total é
    // qtd × unit (023) — o pai tem sempre quantidade 1.
    const setMass = parent.children.reduce(
      (sum, child) => sum + (child.unitWeightKg ?? 0) * child.quantity,
      0,
    );
    if (parent.children.length > 0 && setMass > 0) {
      parent.unitWeightKg = setMass;
      parent.totalWeightKg = calculateTotalWeight(parent.quantity, setMass);
    }

    if (!parent.description) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "warning",
          where: parent.code,
          column: "PEÇA",
          message: "Conjunto sem tipo do produto (PEÇA) — a descrição fica vazia.",
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
            column: "QUANTIDADE EM PROJETO",
            message: "Quantidade do item filho ausente ou inválida (QUANTIDADE EM PROJETO).",
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
        column: "GT/MD",
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
