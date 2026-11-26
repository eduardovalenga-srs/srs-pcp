import type { ProductionOrderRow, ProductionRow } from "@/lib/types/production";
import type { ChildItemGroup } from "@/lib/types/order";

type OrderFamilyRow = Pick<ProductionOrderRow | ProductionRow | ChildItemGroup, "orderCode"> & {
  orderFamilyAbbreviation?: string | null;
};

/** Aplica o filtro textual e, quando solicitado, ordena pelo código da família. */
export function filterAndSortByOrderFamily<T extends OrderFamilyRow>(
  rows: readonly T[],
  filter: string,
  sortDir: "asc" | "desc",
  sortByFamily: boolean,
): T[] {
  const needle = filter.trim().toLocaleLowerCase();
  const filtered = needle
    ? rows.filter((row) => row.orderFamilyAbbreviation?.toLocaleLowerCase().includes(needle))
    : [...rows];

  if (!sortByFamily) return filtered;

  return filtered.sort((left, right) => {
    const a = left.orderFamilyAbbreviation || null;
    const b = right.orderFamilyAbbreviation || null;
    // Famílias sem abreviação ficam por último, em qualquer direção.
    if (a === null || b === null) {
      if (a === b) return left.orderCode.localeCompare(right.orderCode);
      return a === null ? 1 : -1;
    }

    const familyOrder = a.localeCompare(b, undefined, { sensitivity: "base" });
    if (familyOrder !== 0) return sortDir === "asc" ? familyOrder : -familyOrder;
    return left.orderCode.localeCompare(right.orderCode);
  });
}
