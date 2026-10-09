import type {
  BuiltOf,
  ExistingOfItem,
  ExistingOfStructure,
  FileMaterial,
  ImportPreview,
  OfDecisionMap,
  OfDifference,
  OfPreview,
} from "@/lib/types/import";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";

/**
 * Prévias de conflito e plano de gravação da importação nova.
 *
 * - `computeOfDifferences` compara SISTEMA x ARQUIVO campo a campo
 *   (OF, itens pai e filhos) para a prévia perguntar o que fazer;
 * - `buildOfImportPlan` transforma a prévia + decisões por OF no plano
 *   que vai para a RPC transacional `apply_of_import`.
 */

export type OfPlanAction = "CREATE" | "UPDATE" | "KEEP" | "SKIP";

export interface OfPlanOperation {
  action: OfPlanAction;
  order: {
    code: string;
    type: string;
    customerName: string;
    description: string;
    deliveryDate: string;
  };
  /** Estrutura enviada em CREATE/UPDATE (vazio nas demais ações). */
  parents: BuiltOf["parents"];
}

export interface OfPlanSummary {
  create: number;
  update: number;
  keep: number;
  skip: number;
  errors: number;
}

export interface OfImportPlan {
  operations: OfPlanOperation[];
  summary: OfPlanSummary;
}

const FIELD_LABELS: Record<string, string> = {
  customerName: "Cliente",
  description: "Descrição",
  deliveryDate: "Entrega",
  quantity: "Quantidade",
  unitWeightKg: "Peso unitário",
  totalWeightKg: "Peso total",
  family: "TP (família)",
  materials: "Matéria-prima",
  item: "Item",
};

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (text(left) ?? "") === (text(right) ?? "");
}

function sameNumber(left: number | null, right: number | null): boolean {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return Math.abs(left - right) < 1e-6;
}

function materialList(materials: FileMaterial[] | ExistingOfItem["materials"]): string | null {
  if (materials.length === 0) return null;
  return materials
    .map((material) => `${material.description} × ${formatQuantity(material.quantity)} ${material.unit}`)
    .join("; ");
}

function itemSummary(item: { description: string; quantity: number }): string {
  return `${item.description} (qtd. ${formatQuantity(item.quantity)})`;
}

function pushDiff(diffs: OfDifference[], diff: Omit<OfDifference, "label">): void {
  diffs.push({ ...diff, label: FIELD_LABELS[diff.field] ?? diff.field });
}

/** Diferenças de um item casado (campos + materiais). */
function pushItemDiffs(
  diffs: OfDifference[],
  scope: "parent" | "child",
  code: string,
  parentCode: string | null,
  incoming: {
    description: string;
    family: string | null;
    quantity: number;
    unitWeightKg: number | null;
    totalWeightKg: number | null;
    materials: FileMaterial[];
  },
  existing: ExistingOfItem,
): void {
  const fields: { field: string; current: string | null; incoming: string | null }[] = [
    {
      field: "description",
      current: text(existing.description),
      incoming: text(incoming.description),
    },
    {
      field: "quantity",
      current: formatQuantity(existing.quantity),
      incoming: formatQuantity(incoming.quantity),
    },
    {
      field: "unitWeightKg",
      current: existing.unitWeightKg === null ? null : formatWeight(existing.unitWeightKg),
      incoming: incoming.unitWeightKg === null ? null : formatWeight(incoming.unitWeightKg),
    },
    {
      field: "totalWeightKg",
      current: existing.totalWeightKg === null ? null : formatWeight(existing.totalWeightKg),
      incoming: incoming.totalWeightKg === null ? null : formatWeight(incoming.totalWeightKg),
    },
    {
      field: "family",
      current: text(existing.family),
      incoming: text(incoming.family),
    },
  ];

  for (const entry of fields) {
    if (entry.field === "quantity") {
      if (sameNumber(existing.quantity, incoming.quantity)) continue;
    } else if (sameText(entry.current, entry.incoming)) {
      continue;
    }
    pushDiff(diffs, {
      scope,
      code,
      parentCode,
      field: entry.field,
      current: entry.current,
      incoming: entry.incoming,
      kind: "changed",
    });
  }

  const currentMaterials = materialList(existing.materials);
  const incomingMaterials = materialList(incoming.materials);
  if ((currentMaterials ?? "") !== (incomingMaterials ?? "")) {
    pushDiff(diffs, {
      scope,
      code,
      parentCode,
      field: "materials",
      current: currentMaterials,
      incoming: incomingMaterials,
      kind: "changed",
    });
  }
}

/**
 * Diferenças entre a OF do arquivo e a existente no sistema. A ordem é
 * estável (OF -> pais na ordem do arquivo -> filhos) para a prévia
 * mostrar o diff na mesma ordem da estrutura.
 */
export function computeOfDifferences(order: BuiltOf, existing: ExistingOfStructure | null): OfDifference[] {
  if (!existing) return [];
  const diffs: OfDifference[] = [];

  const orderFields: { field: string; current: string | null; incoming: string | null }[] = [
    { field: "customerName", current: text(existing.customerName), incoming: text(order.customerName) },
    { field: "description", current: text(existing.description), incoming: text(order.description) },
    { field: "deliveryDate", current: text(existing.deliveryDate), incoming: text(order.deliveryDate) },
  ];
  for (const entry of orderFields) {
    if (sameText(entry.current, entry.incoming)) continue;
    pushDiff(diffs, {
      scope: "order",
      code: order.code,
      parentCode: null,
      field: entry.field,
      current: entry.current,
      incoming: entry.incoming,
      kind: "changed",
    });
  }

  const existingParents = existing.items.filter((item) => item.parentItemId === null);
  const incomingParentCodes = new Set(order.parents.map((parent) => parent.code));

  for (const parent of order.parents) {
    const existingParent = existingParents.find((item) => item.code === parent.code);
    if (!existingParent) {
      pushDiff(diffs, {
        scope: "parent",
        code: parent.code,
        parentCode: null,
        field: "item",
        current: null,
        incoming: itemSummary(parent),
        kind: "added",
      });
    } else {
      pushItemDiffs(diffs, "parent", parent.code, null, parent, existingParent);
    }

    for (const child of parent.children) {
      const existingChild = existing.items.find(
        (item) => item.parentItemId === existingParent?.id && item.code === child.code,
      );
      if (!existingChild) {
        pushDiff(diffs, {
          scope: "child",
          code: child.code,
          parentCode: parent.code,
          field: "item",
          current: null,
          incoming: itemSummary(child),
          kind: "added",
        });
      } else {
        pushItemDiffs(diffs, "child", child.code, parent.code, child, existingChild);
      }
    }
  }

  // Itens que existem no sistema e sumiram do arquivo serão removidos.
  for (const item of existing.items) {
    if (item.parentItemId === null) {
      if (incomingParentCodes.has(item.code)) continue;
      pushDiff(diffs, {
        scope: "parent",
        code: item.code,
        parentCode: null,
        field: "item",
        current: itemSummary(item),
        incoming: null,
        kind: "removed",
        hasProgress: item.hasProgress,
      });
      continue;
    }

    const parentItem = existing.items.find((entry) => entry.id === item.parentItemId);
    if (!parentItem) continue;
    const incomingParent = order.parents.find((entry) => entry.code === parentItem.code);
    if (incomingParent?.children.some((child) => child.code === item.code)) continue;
    pushDiff(diffs, {
      scope: "child",
      code: item.code,
      parentCode: parentItem.code,
      field: "item",
      current: itemSummary(item),
      incoming: null,
      kind: "removed",
      hasProgress: item.hasProgress,
    });
  }

  return diffs;
}

/**
 * Plano de gravação: OFs com erro ficam de fora; OFs novas viram CREATE;
 * OFs existentes só entram com a decisão explícita do usuário (UPDATE /
 * KEEP / SKIP) — nunca há sobrescrita silenciosa.
 */
export function buildOfImportPlan(preview: ImportPreview, decisions: OfDecisionMap): OfImportPlan {
  const summary: OfPlanSummary = { create: 0, update: 0, keep: 0, skip: 0, errors: 0 };
  const operations: OfPlanOperation[] = [];

  for (const entry of preview.orders) {
    if (entry.status === "ERROR") {
      summary.errors += 1;
      continue;
    }

    let action: OfPlanAction;
    if (!entry.exists) {
      action = "CREATE";
    } else {
      const decision = decisions[entry.order.code];
      if (decision !== "UPDATE" && decision !== "KEEP" && decision !== "SKIP") {
        throw new Error(
          `Informe o que fazer com a OF ${entry.order.code} (atualizar, manter ou ignorar) antes de confirmar.`,
        );
      }
      action = decision;
    }

    if (action === "CREATE") summary.create += 1;
    else if (action === "UPDATE") summary.update += 1;
    else if (action === "KEEP") summary.keep += 1;
    else summary.skip += 1;

    operations.push({
      action,
      order: {
        code: entry.order.code,
        type: entry.order.type,
        customerName: entry.order.customerName,
        description: entry.order.description,
        deliveryDate: entry.order.deliveryDate,
      },
      parents: action === "CREATE" || action === "UPDATE" ? entry.order.parents : [],
    });
  }

  return { operations, summary };
}

/** OFs existentes que precisam de decisão (para desabilitar o continuar). */
export function undecidedOrders(preview: ImportPreview, decisions: OfDecisionMap): OfPreview[] {
  return preview.orders.filter(
    (entry) => entry.exists && entry.status !== "ERROR" && !decisions[entry.order.code],
  );
}
