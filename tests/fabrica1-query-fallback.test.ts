import { describe, expect, it, vi } from "vitest";

import {
  getChildItemsKitOverdueTotals,
  listChildItemGroups,
} from "@/lib/repositories/order-items.repository";
import { parseChildItemFilters } from "@/lib/utils/filters";

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc, from: vi.fn() } as never;
}

describe("Fábrica 1 — caminho rápido e resumo sob demanda", () => {
  it("a listagem inicial usa as RPCs paginadas e não chama a função lenta", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "get_child_item_groups"
        ? { data: { total: 0, groups: [] }, error: null }
        : { data: { qtyTotal: 0, weightTotal: 0 }, error: null },
    );

    const result = await listChildItemGroups(
      clientWithRpc(rpc),
      parseChildItemFilters({}),
      null,
      "2026-11-12",
    );

    expect(rpc.mock.calls.map(([name]) => name).sort()).toEqual([
      "get_child_item_groups",
      "get_child_items_totals",
    ]);
    expect(result.kitOverdue).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("calcula o resumo KIT em memória usando as filas do Sequenciamento", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "get_child_item_groups"
        ? { data: { total: 0, groups: [] }, error: null }
        : { data: { qtyTotal: 0, weightTotal: 0 }, error: null },
    );

    const totals = await getChildItemsKitOverdueTotals(
      clientWithRpc(rpc),
      parseChildItemFilters({}),
      null,
      "2026-11-12",
    );

    expect(totals).toEqual({ records: 0, qty: 0, weight: 0 });
    expect(rpc.mock.calls.map(([name]) => name).sort()).toEqual([
      "get_child_item_groups",
      "get_child_items_totals",
    ]);
  });
});
