import { findMissingTechnicalColumns, normalizeHeader } from "@/lib/import/excel-parser";
import type {
  BuiltOf,
  FileChild,
  ParsedSheet,
  StructureIssue,
} from "@/lib/types/import";
import { toNumber } from "@/lib/utils/formatting";

/**
 * Construção da estrutura hierárquica do arquivo novo:
 *
 *   OF (of_idOF + OF_TIPO + of_Descr)
 *     -> itens pai (ps_idPos, ps_Descr, ps_Qtde, ps_Peso, pos_PesoTotal)
 *        -> itens filhos (cp_comp, cp_compdescr, cp_compqtdetotal,
 *           cp_comppeso, cp_comppesototal)
 *           -> matéria-prima por item (cp_DesMaterial + código/qualidade
 *              nas observações)
 *        -> material direto no pai (ps_DesMaterial — posições tipo X,
 *           sem filhos)
 *
 * O mapeamento é 100% pelo NOME técnico da coluna (sem posição, sem
 * etapa de mapeamento manual). Cliente e data de entrega vêm do
 * formulário da importação e valem para TODOS os registros.
 */

/** Cliente + data digitados no formulário da importação. */
export interface StructureFormInput {
  customerName: string;
  deliveryDate: string;
}

/** Índice coluna técnica -> posição na planilha (primeira ocorrência). */
type ColumnIndex = Record<string, number>;

/** Colunas técnicas lidas pelo construtor (demais são ignoradas). */
const CONSUMED_COLUMNS = [
  "of_idOF",
  "OF_TIPO",
  "of_Descr",
  "ps_idPos",
  "ps_Descr",
  "ps_Qtde",
  "ps_Peso",
  "pos_PesoTotal",
  "ps_Tipo",
  "ps_idMat",
  "ps_DesMaterial",
  "ps_Qualidade",
  "cp_comp",
  "cp_compdescr",
  "cp_compqtdetotal",
  "cp_comppeso",
  "cp_comppesototal",
  "co_compcodmat",
  "cp_DesMaterial",
  "cp_Qualidade",
] as const;

/** Valor textual de uma célula (números viram texto sem sinalizador). */
function cellText(row: unknown[], index: number | undefined): string {
  if (index === undefined) return "";
  const cell = row[index];
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

function cellNumber(row: unknown[], index: number | undefined): { value: number | null; raw: string } {
  const text = cellText(row, index);
  if (!text) return { value: null, raw: "" };
  return { value: toNumber(text), raw: text };
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

/**
 * TP (família) = iniciais da própria descrição do item — mesma regra para
 * pai e filho (ex.: "GUARDA CORPO" -> "GC").
 */
export function familyFromDescription(description: string): string | null {
  const words = description.split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
  if (words.length === 0) return null;
  const initials = words.map((word) => word.charAt(0).toUpperCase()).join("");
  return initials || null;
}

/** Código do pedido: "OF 107482" (prefere o prefixo do próprio código). */
function buildOrderCode(id: string, typeHint: string): { code: string; type: string } {
  const prefixed = /^(OF|OS)[\s-]*(.*)$/i.exec(id);
  const type = prefixed ? prefixed[1].toUpperCase() : typeHint.toUpperCase() === "OS" ? "OS" : "OF";
  const rawId = (prefixed ? prefixed[2] : id).trim();
  return { code: `${type} ${rawId}`.trim(), type };
}

function issue(partial: StructureIssue): StructureIssue {
  return partial;
}

/** Material válido? "SEM MATERIAL" (e variantes) significa ausência. */
function materialDescription(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const normalized = normalizeHeader(text);
  // "", "-" e "—" (normalizados para vazio) também significam ausência.
  if (normalized === "" || normalized === "SEMMATERIAL" || normalized === "NENHUM") return null;
  return text;
}

/**
 * Monta a estrutura OF -> pais -> filhos -> materiais a partir da aba já
 * com o cabeçalho técnico detectado. Lança erro quando faltam colunas
 * obrigatórias (arquivo fora do formato esperado).
 */
export function buildOfStructure(
  sheet: ParsedSheet,
  form: StructureFormInput,
): { orders: BuiltOf[]; ignoredColumns: string[] } {
  const missing = findMissingTechnicalColumns(sheet.headers);
  if (missing.length > 0) {
    throw new Error(
      `Colunas obrigatórias ausentes na planilha: ${missing.join(", ")}. O arquivo não está no formato esperado — use o modelo oficial.`,
    );
  }

  const col: ColumnIndex = {};
  sheet.headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !(key in col)) col[key] = index;
  });

  const orders = new Map<string, BuiltOf>();
  const seenChildren = new Map<string, Set<string>>();
  const consumed = new Set(CONSUMED_COLUMNS.map(normalizeHeader));

  const getOrCreateOrder = (code: string, type: string, sourceRow: number): BuiltOf => {
    const existing = orders.get(code);
    if (existing) return existing;
    const created: BuiltOf = {
      code,
      type,
      customerName: form.customerName,
      description: "",
      deliveryDate: form.deliveryDate,
      parents: [],
      sourceRow,
      issues: [],
    };
    orders.set(code, created);
    return created;
  };

  sheet.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    // Linha Excel: cabeçalho técnico (0-based) + 1 + índice da linha de dados.
    const excelRow = sheet.headerRowIndex + index + 2;

    const rawId = cellText(row, col.OFIDOF);
    if (!rawId) {
      orders.set(`(linha ${excelRow})`, {
        code: `(linha ${excelRow})`,
        type: "OF",
        customerName: form.customerName,
        description: "",
        deliveryDate: form.deliveryDate,
        parents: [],
        sourceRow: excelRow,
        issues: [
          issue({
            type: "REQUIRED",
            severity: "error",
            where: `Linha ${excelRow}`,
            column: "of_idOF",
            message: "Linha sem código de OF (of_idOF) — ignorada.",
            rawValue: null,
          }),
        ],
      });
      return;
    }

    const { code: orderCode, type: orderType } = buildOrderCode(rawId, cellText(row, col.OFTIPO));
    const order = getOrCreateOrder(orderCode, orderType, excelRow);

    const orderDescription = cellText(row, col.OFDESCR);
    if (!order.description && orderDescription) order.description = orderDescription;

    const parentCode = cellText(row, col.PSIDPOS);
    if (!parentCode) {
      order.issues.push(
        issue({
          type: "REQUIRED",
          severity: "error",
          where: `Linha ${excelRow}`,
          column: "ps_idPos",
          message: "Linha sem código de item pai (ps_idPos) — ignorada.",
          rawValue: null,
        }),
      );
      return;
    }

    // -------------------------------------------------------
    // Item pai — campos lidos na primeira linha da posição
    // -------------------------------------------------------
    let parent = order.parents.find((entry) => entry.code === parentCode);
    if (!parent) {
      const description = cellText(row, col.PSDESCR);
      const quantity = cellNumber(row, col.PSQTDE);
      const unitWeight = cellNumber(row, col.PSPESO);
      const totalWeight = cellNumber(row, col.POSPESETOTAL);

      parent = {
        code: parentCode,
        description,
        family: familyFromDescription(description),
        quantity: quantity.value ?? 0,
        unitWeightKg: unitWeight.value,
        totalWeightKg: totalWeight.value,
        deliveryDate: form.deliveryDate,
        materials: [],
        children: [],
      };
      order.parents.push(parent);

      if (unitWeight.raw && unitWeight.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: parentCode,
            column: "ps_Peso",
            message: `Peso unitário inválido ignorado: "${unitWeight.raw}".`,
            rawValue: unitWeight.raw,
          }),
        );
      }
      if (totalWeight.raw && totalWeight.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: parentCode,
            column: "pos_PesoTotal",
            message: `Peso total inválido ignorado: "${totalWeight.raw}".`,
            rawValue: totalWeight.raw,
          }),
        );
      }
    }

    // -------------------------------------------------------
    // Item filho (cp_comp presente)
    // -------------------------------------------------------
    const childCode = cellText(row, col.CPCOMP);
    if (childCode) {
      const siblings = seenChildren.get(orderCode);
      const childKey = `${parentCode}::${childCode}`;
      const seen = siblings ?? new Set<string>();
      if (!siblings) seenChildren.set(orderCode, seen);

      if (seen.has(childKey)) {
        order.issues.push(
          issue({
            type: "DUPLICATE",
            severity: "warning",
            where: `${parentCode} / ${childCode}`,
            column: "cp_comp",
            message: "Filho repetido no arquivo — a primeira ocorrência foi mantida.",
            rawValue: childCode,
          }),
        );
        return;
      }
      seen.add(childKey);

      const description = cellText(row, col.CPCOMPDESCR) || childCode;
      const quantity = cellNumber(row, col.CPCOMPQTDETOTAL);
      const unitWeight = cellNumber(row, col.CPCOMPPESO);
      const totalWeight = cellNumber(row, col.CPCOMPPESETOTAL);

      const child: FileChild = {
        code: childCode,
        description,
        family: familyFromDescription(description),
        quantity: quantity.value ?? 0,
        unitWeightKg: unitWeight.value,
        totalWeightKg: totalWeight.value,
        deliveryDate: form.deliveryDate,
        materials: [],
      };

      const rawMaterial = cellText(row, col.CPDESMATERIAL);
      const material = materialDescription(rawMaterial);
      if (material) {
        const notes = [cellText(row, col.COCOMPCODMAT), cellText(row, col.CPQUALIDADE)]
          .filter(Boolean)
          .join(" · ");
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
            where: `${parentCode} / ${childCode}`,
            column: "cp_DesMaterial",
            message: "Item filho sem matéria-prima informada.",
            rawValue: rawMaterial || null,
          }),
        );
      }

      if (unitWeight.raw && unitWeight.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: `${parentCode} / ${childCode}`,
            column: "cp_comppeso",
            message: `Peso unitário inválido ignorado: "${unitWeight.raw}".`,
            rawValue: unitWeight.raw,
          }),
        );
      }
      if (totalWeight.raw && totalWeight.value === null) {
        order.issues.push(
          issue({
            type: "NUMBER",
            severity: "warning",
            where: `${parentCode} / ${childCode}`,
            column: "cp_comppesototal",
            message: `Peso total inválido ignorado: "${totalWeight.raw}".`,
            rawValue: totalWeight.raw,
          }),
        );
      }

      parent.children.push(child);
      return;
    }

    // -------------------------------------------------------
    // Linha sem filho: material direto no pai (posição tipo X)
    // -------------------------------------------------------
    const rawDirect = cellText(row, col.PSDESMATERIAL);
    const directMaterial = materialDescription(rawDirect);
    if (directMaterial && parent.materials.length === 0) {
      const quantity = cellNumber(row, col.PSQTDE);
      const notes = [cellText(row, col.PSIDMAT), cellText(row, col.PSQUALIDADE)]
        .filter(Boolean)
        .join(" · ");
      parent.materials.push({
        description: directMaterial,
        quantity: quantity.value ?? parent.quantity,
        unit: "UN",
        notes: notes || null,
      });
    }
  });

  // -------------------------------------------------------
  // Validação da estrutura montada (erros excluem a OF inteira)
  // -------------------------------------------------------
  for (const order of orders.values()) {
    if (order.parents.length === 0 && !order.issues.some((entry) => entry.severity === "error")) {
      order.issues.push(
        issue({
          type: "STRUCTURE",
          severity: "error",
          where: order.code,
          column: "ps_idPos",
          message: "OF sem itens pai válidos — nada a importar.",
          rawValue: null,
        }),
      );
    }

    for (const parent of order.parents) {
      if (!parent.description) {
        order.issues.push(
          issue({
            type: "REQUIRED",
            severity: "error",
            where: parent.code,
            column: "ps_Descr",
            message: "Item pai sem descrição (ps_Descr).",
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
            column: "ps_Qtde",
            message: "Quantidade do item pai ausente ou inválida (ps_Qtde).",
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
              column: "cp_compqtdetotal",
              message: "Quantidade do item filho ausente ou inválida (cp_compqtdetotal).",
              rawValue: null,
            }),
          );
        }
      }
    }
  }

  const ignoredColumns = sheet.headers.filter(
    (header) => header.trim() !== "" && !consumed.has(normalizeHeader(header)),
  );

  return { orders: [...orders.values()], ignoredColumns };
}

/** Status agregado de uma OF: erro > alerta > ok. */
export function orderStatusOf(issues: StructureIssue[]): "ERROR" | "WARNING" | "VALID" {
  if (issues.some((entry) => entry.severity === "error")) return "ERROR";
  if (issues.some((entry) => entry.severity === "warning")) return "WARNING";
  return "VALID";
}
