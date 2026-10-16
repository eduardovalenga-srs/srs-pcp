import { MAX_IMPORT_ROWS, PDF_COMPOSITION_SHEET_NAME } from "@/lib/constants/import";
import type { StructureFormInput } from "@/lib/import/of-structure";
import { familyFromDescription } from "@/lib/import/of-structure";
import type { PdfRow } from "@/lib/import/pdf-text";
import type { BuiltOf, FileChild, FileMaterial, FileParent, StructureIssue } from "@/lib/types/import";
import { calculateTotalWeight, formatWeight, toNumber } from "@/lib/utils/formatting";
import { normalizeOrderCode } from "@/lib/utils/order-code";

export { PDF_COMPOSITION_SHEET_NAME };

/**
 * Parser do PDF da A1 Engenharia (Ordem de Fabricação) -> mesma árvore
 * BuiltOf que a planilha produz (OF -> itens pai -> filhos -> MP).
 *
 * Tudo a jusante de BuiltOf (prévia, diffs, decisões, plano, RPC, lote)
 * é reutilizado sem mudança — este módulo só converte linhas de texto do
 * PDF (extraídas em `pdf-text.ts`) na estrutura hierárquica.
 *
 * Layout lido (seção "COMPOSIÇÃO DOS CONJUNTOS"):
 *
 *   2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 10,16 kg
 *   P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)
 *   MPELIAC2NH0 - PERFIL L ... - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)
 *   MCHPAC0J000 - CHAPA PLANA ... - ESP. 1/2" - 0,053M2 (Peso: 5,28 kg) Dim. 230x230
 *
 *  - Cabeçalho do conjunto traz código, descrição, "N PÇS" e o Peso
 *    Unitário na MESMA linha visual.
 *  - Filho e matéria-prima aparecem em linhas separadas, em qualquer
 *    ordem (filho acima ou abaixo do material): o pareamento é feito
 *    pelo PESO COINCIDENTE no bloco, com fallback de ordem.
 *  - Cliente e data de entrega NÃO vêm do PDF — só do formulário
 *    (mesma regra da planilha).
 */

/** Tolerância de pareamento material x filho pelo peso (kg). */
const PAIRING_WEIGHT_TOLERANCE = 0.01;

/** Tolerância da soma dos filhos vs. peso unitário do conjunto (arredondamento). */
function sumCheckTolerance(parentWeight: number): number {
  return Math.max(0.05, parentWeight * 0.02);
}

// -------------------------------------------------------------
// Metadados (linhas antes da seção de composição / banner)
// -------------------------------------------------------------

/** "OF Nº:2615-AA-4 Rev.0" -> "2615-AA-4" (sem a revisão). */
const OF_CODE_RE = /^OF\s*N[°ºo]\s*:?\s*(.+)$/i;
const OF_REVISION_SUFFIX_RE = /\s+Rev\.?\s*\S*\s*$/i;

/** "Descrição FABRICAÇÃO DE SECUNDARIOS AC - ..." -> valor. */
const OF_DESCRIPTION_RE = /^Descri[çc][ãa]o:?\s+(.+)$/i;

// -------------------------------------------------------------
// Linhas da composição
// -------------------------------------------------------------

/** Cabeçalho de conjunto: "<código> <DESCRIÇÃO> - <n> PÇS [Peso Unitário: X kg]". */
const PARENT_RE = /^(\S{3,})\s+(.+?)\s*-\s*([\d.,]+)\s*P[ÇC]S\b(?:\s+Peso\s+Unit[áa]rio:\s*([\d.,]+)\s*kg)?/i;

/** Filho (peça): "<código> - <n>,<n> CJ (Peso: X,XX kg)". */
const CHILD_RE = /^(\S+)\s*-\s*([\d.,]+)\s*CJ\b(?:\s*\(Peso:\s*([\d.,]+)\s*kg\))?/i;

/**
 * Matéria-prima: "<código> - <descrição entre hifens> - <qtd><unid>
 * (Peso: X,XX kg) [Dim. ...]". A unidade dimensional (M/M2) vai para as
 * observações; a QUANTIDADE vira o PESO em KG (decisão de mapeamento).
 */
const MATERIAL_RE =
  /^([A-Z][A-Z0-9]*)\s+-\s+(.+?)\s+-\s+([\d.,]+)\s*(M2|M3|M|KG|L|UN|CX|SC|G)\s*\(Peso:\s*([\d.,]+)\s*kg\)(?:\s*Dim\.\s*(\S+))?/i;

/** Títulos de outras seções do documento (encerram a composição). */
const SECTION_END_RE = /^(RESUMO|ESPECIFICACOES|LISTA DE |PLACA DE )/;

const COMPOSITION_TITLE = "COMPOSICAO DOS CONJUNTOS";

/** Normaliza para comparação de títulos: sem acento, maiúsculo, espaços simples. */
function normalizeTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function issue(partial: StructureIssue): StructureIssue {
  return partial;
}

// -------------------------------------------------------------
// Bloco em construção (conjunto + filhos + materiais do bloco)
// ---------------------------------------------------------

interface BlockChild {
  child: FileChild;
}

interface BlockMaterial {
  material: FileMaterial;
  /** Peso do "(Peso: X kg)" da linha, para o pareamento. */
  peso: number | null;
  page: number;
}

interface Block {
  parent: FileParent;
  children: BlockChild[];
  materials: BlockMaterial[];
}

/**
 * Fecha um bloco: pareia materiais e filhos pelo peso coincidente
 * (com fallback de ordem), avisa órfãos e confere a soma dos filhos
 * contra o Peso Unitário do cabeçalho.
 */
function flushBlock(order: BuiltOf, block: Block): void {
  const paired = new Set<FileChild>();

  // 1) Pareamento principal: peso do material coincide com o peso do filho.
  const unpaired: BlockMaterial[] = [];
  for (const entry of block.materials) {
    const match =
      entry.peso === null
        ? undefined
        : block.children.find(
            ({ child }) =>
              !paired.has(child) &&
              child.unitWeightKg !== null &&
              Math.abs(child.unitWeightKg - entry.peso!) <= PAIRING_WEIGHT_TOLERANCE,
          );
    if (match) {
      match.child.materials.push(entry.material);
      paired.add(match.child);
    } else {
      unpaired.push(entry);
    }
  }

  // 2) Fallback: um material e um filho restantes -> pareia por ordem.
  if (unpaired.length > 0) {
    const leftovers = block.children.filter(({ child }) => !paired.has(child));
    if (unpaired.length === 1 && leftovers.length === 1 && leftovers[0]) {
      leftovers[0].child.materials.push(unpaired[0].material);
      paired.add(leftovers[0].child);
      unpaired.length = 0;
    }
  }

  // 3) Materiais sem peça correspondente: vão para o pai, com aviso.
  for (const entry of unpaired) {
    block.parent.materials.push(entry.material);
    order.issues.push(
      issue({
        type: "STRUCTURE",
        severity: "warning",
        where: `Página ${entry.page}`,
        column: null,
        message: `${block.parent.code}: matéria-prima sem peça correspondente — anexada ao item pai.`,
        rawValue: entry.material.description,
      }),
    );
  }

  // 4) Filhos sem matéria-prima (mesmo aviso do caminho da planilha).
  for (const { child } of block.children) {
    if (child.materials.length === 0) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "warning",
          where: `${block.parent.code} / ${child.code}`,
          column: null,
          message: "Item filho sem matéria-prima informada.",
          rawValue: null,
        }),
      );
    }
  }

  // 5) Soma dos pesos dos filhos x Peso Unitário do cabeçalho (023).
  if (block.parent.unitWeightKg !== null && block.children.length > 0) {
    const sum = block.children.reduce(
      (total, { child }) => (child.unitWeightKg === null ? total : total + child.unitWeightKg),
      0,
    );
    const tolerance = sumCheckTolerance(block.parent.unitWeightKg);
    if (Math.abs(sum - block.parent.unitWeightKg) > tolerance) {
      order.issues.push(
        issue({
          type: "NUMBER",
          severity: "warning",
          where: block.parent.code,
          column: null,
          message:
            `Soma dos pesos dos filhos (${formatWeight(sum)} kg) difere do ` +
            `Peso Unitário do conjunto (${formatWeight(block.parent.unitWeightKg)} kg).`,
          rawValue: null,
        }),
      );
    }
  }
}

// -------------------------------------------------------------
// Parser principal
// -------------------------------------------------------------

/**
 * Constrói a estrutura OF -> pais -> filhos -> MP a partir das linhas do
 * PDF. Lança erro amigável quando o documento não tem a seção esperada
 * (é o caso do PDF que não é uma Ordem de Fabricação da A1).
 */
export function buildOfFromPdfRows(rows: PdfRow[], form: StructureFormInput): { orders: BuiltOf[] } {
  // -------------------------------------------------------
  // Metadados: código da OF (banner, primeira ocorrência) e
  // descrição (linhas antes da composição).
  // -------------------------------------------------------
  const ofCodeRow = rows.find((row) => OF_CODE_RE.test(row.text));
  const rawOfCode = ofCodeRow ? OF_CODE_RE.exec(ofCodeRow.text)?.[1]?.trim() : null;
  if (!rawOfCode) {
    throw new Error('Não foi possível identificar o código da OF no PDF (linha "OF Nº: ...").');
  }
  const { code, type } = normalizeOrderCode(rawOfCode.replace(OF_REVISION_SUFFIX_RE, ""), "OF");

  const compositionIndex = rows.findIndex((row) => normalizeTitle(row.text).startsWith(COMPOSITION_TITLE));
  if (compositionIndex < 0) {
    throw new Error(
      'O PDF não contém a seção "COMPOSIÇÃO DOS CONJUNTOS". Baixe o PDF da Ordem de Fabricação da A1 Engenharia.',
    );
  }

  const descriptionRow = rows
    .slice(0, compositionIndex)
    .find((row) => OF_DESCRIPTION_RE.test(row.text));
  const description = descriptionRow ? OF_DESCRIPTION_RE.exec(descriptionRow.text)?.[1]?.trim() ?? "" : "";

  const order: BuiltOf = {
    code,
    type,
    customerName: form.customerName,
    description,
    deliveryDate: form.deliveryDate,
    parents: [],
    // "Linha" para a prévia/lote: usamos a página da seção.
    sourceRow: rows[compositionIndex].page,
    issues: [],
  };

  // -------------------------------------------------------
  // Varredura da seção: máquina de estados por blocos.
  // -------------------------------------------------------
  const parentsByCode = new Map<string, FileParent>();
  const seenChildren = new Map<string, Set<string>>();
  let current: Block | null = null;

  const startBlock = (parentCode: string): Block => {
    let parent = parentsByCode.get(parentCode);
    if (!parent) {
      parent = {
        code: parentCode,
        description: "",
        family: null,
        quantity: 0,
        unitWeightKg: null,
        totalWeightKg: null,
        deliveryDate: form.deliveryDate,
        materials: [],
        children: [],
      };
      parentsByCode.set(parentCode, parent);
      order.parents.push(parent);
    }
    return { parent, children: [], materials: [] };
  };

  for (let index = compositionIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const text = row.text.trim();
    if (!text) continue;

    // Encerramento por título de outra seção do documento.
    if (SECTION_END_RE.test(normalizeTitle(text))) break;

    const parentMatch = PARENT_RE.exec(text);
    if (parentMatch) {
      if (current) flushBlock(order, current);
      const parentCode = parentMatch[1];
      const parentDescription = parentMatch[2].trim();
      const quantity = toNumber(parentMatch[3]) ?? 0;
      const unitWeightKg = parentMatch[4] !== undefined ? toNumber(parentMatch[4]) : null;

      current = startBlock(parentCode);
      // Só preenche na primeira ocorrência do código (blocos repetidos
      // no mesmo documento não sobrescrevem a descrição original).
      if (!current.parent.description) {
        current.parent.description = parentDescription;
        current.parent.family = familyFromDescription(parentDescription);
      }
      if (current.parent.quantity === 0) {
        current.parent.quantity = quantity;
        current.parent.unitWeightKg = unitWeightKg;
        current.parent.totalWeightKg = calculateTotalWeight(quantity, unitWeightKg);
      }
      continue;
    }

    const childMatch = CHILD_RE.exec(text);
    if (childMatch) {
      if (!current) continue; // linha de filho fora de bloco: ignorada
      const childCode = childMatch[1];
      const seen = seenChildren.get(current.parent.code) ?? new Set<string>();
      seenChildren.set(current.parent.code, seen);
      if (seen.has(childCode)) {
        order.issues.push(
          issue({
            type: "DUPLICATE",
            severity: "warning",
            where: `${current.parent.code} / ${childCode}`,
            column: null,
            message: "Filho repetido no arquivo — a primeira ocorrência foi mantida.",
            rawValue: childCode,
          }),
        );
        continue;
      }
      seen.add(childCode);

      const quantity = toNumber(childMatch[2]) ?? 0;
      const unitWeightKg = childMatch[3] !== undefined ? toNumber(childMatch[3]) : null;
      const child: FileChild = {
        code: childCode,
        // Decisão de mapeamento: sem descrição no PDF, o código vira descrição.
        description: childCode,
        family: familyFromDescription(childCode),
        quantity,
        unitWeightKg,
        totalWeightKg: calculateTotalWeight(quantity, unitWeightKg),
        deliveryDate: form.deliveryDate,
        materials: [],
      };
      current.parent.children.push(child);
      current.children.push({ child });
      continue;
    }

    const materialMatch = MATERIAL_RE.exec(text);
    if (materialMatch) {
      if (!current) continue; // linha de material fora de bloco: ignorada
      const materialCode = materialMatch[1];
      const materialDescription = materialMatch[2].trim();
      const dimensionalQuantity = materialMatch[3];
      const dimensionalUnit = materialMatch[4].toUpperCase();
      const peso = materialMatch[5] !== undefined ? toNumber(materialMatch[5]) : null;
      const dimensions = materialMatch[6];

      // Decisão de mapeamento: quantidade da MP = PESO em KG; a medida
      // dimensional (0,335M / 0,053M2) e as dimensões vão para observações.
      const notes = [materialCode, `${dimensionalQuantity}${dimensionalUnit}`, dimensions]
        .filter((part): part is string => Boolean(part))
        .join(" · ");

      current.materials.push({
        material: {
          description: materialDescription,
          quantity: peso ?? 0,
          unit: "KG",
          notes,
        },
        peso,
        page: row.page,
      });
      continue;
    }

    // Demais linhas (banner de página, rodapés, avisos) são ignoradas.
  }
  if (current) flushBlock(order, current);

  // -------------------------------------------------------
  // Validação da estrutura montada
  // -------------------------------------------------------
  if (order.parents.length === 0) {
    throw new Error(
      `A seção "${PDF_COMPOSITION_SHEET_NAME}" foi encontrada, mas nenhum conjunto foi reconhecido. Verifique se o PDF é da versão atual.`,
    );
  }

  const itemCount = order.parents.reduce(
    (total, parent) => total + 1 + parent.children.length,
    0,
  );
  if (itemCount > MAX_IMPORT_ROWS) {
    throw new Error(`O PDF possui muitos itens (máximo ${MAX_IMPORT_ROWS}).`);
  }

  for (const parent of order.parents) {
    if (!parent.description) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "error",
          where: parent.code,
          column: null,
          message: "Item pai sem descrição.",
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
          column: null,
          message: "Quantidade do item pai ausente ou inválida.",
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
            column: null,
            message: "Quantidade do item filho ausente ou inválida.",
            rawValue: null,
          }),
        );
      }
    }
  }

  return { orders: [order] };
}
