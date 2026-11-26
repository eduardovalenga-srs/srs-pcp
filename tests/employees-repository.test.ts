import { describe, expect, it, vi } from "vitest";

import { getEmployees } from "@/lib/repositories/employees.repository";
import type { SupabaseServer } from "@/lib/supabase/types";

function fakeClient(pages: unknown[][], total: number | null) {
  const ranges: Array<[number, number]> = [];
  const order = vi.fn();
  let pageIndex = 0;

  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn((...args: unknown[]) => {
      order(...args);
      return builder;
    }),
    range: vi.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      const data = pages[pageIndex] ?? [];
      pageIndex += 1;
      return { data, error: null, count: total };
    }),
  };

  const from = vi.fn(() => builder);
  return {
    client: { from } as unknown as SupabaseServer,
    ranges,
    order,
    from,
  };
}

function employee(index: number) {
  return { id: `employee-${index}`, name: `FUNCIONARIO ${index}` };
}

describe("getEmployees", () => {
  it("percorre todas as páginas e não para no limite de 1.000", async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, index) => employee(index)),
      Array.from({ length: 242 }, (_, index) => employee(index + 1000)),
    ];
    const { client, ranges } = fakeClient(pages, 1242);

    const employees = await getEmployees(client);

    expect(employees).toHaveLength(1242);
    expect(employees[0]).toMatchObject({ id: "employee-0" });
    expect(employees.at(-1)).toMatchObject({ id: "employee-1241" });
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("ordena por nome e por id para manter a paginação estável", async () => {
    const { client, order } = fakeClient([[employee(0)]], 1);

    await getEmployees(client);

    expect(order).toHaveBeenNthCalledWith(1, "name", { ascending: true });
    expect(order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
  });

  it("encerra quando a página vem vazia, mesmo sem total confiável", async () => {
    const { client, ranges } = fakeClient([], null);

    const employees = await getEmployees(client);

    expect(employees).toEqual([]);
    expect(ranges).toEqual([[0, 999]]);
  });
});
