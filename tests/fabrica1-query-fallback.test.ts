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

  it("só consulta a agregação KIT quando o resumo é solicitado", async () => {
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      expect(name).toBe("get_child_item_groups_page");
      expect(args).toMatchObject({ p_limit: 0, p_kit_overdue: false });
      return {
        data: {
          total: 0,
          qtyTotal: 0,
          weightTotal: 0,
          kitOverdue: { records: 2, qty: 8, weight: 12.5 },
          groups: [],
        },
        error: null,
      };
    });

    const totals = await getChildItemsKitOverdueTotals(
      clientWithRpc(rpc),
      parseChildItemFilters({}),
      null,
      "2026-11-12",
    );

    expect(totals).toEqual({ records: 2, qty: 8, weight: 12.5 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_limit: 0, p_kit_overdue: false });
  });
});
