import { describe, expect, it } from "vitest";

import { filterAndSortByOrderFamily } from "@/lib/utils/order-family";

const ROWS = [
  { orderCode: "OF 3", orderFamilyAbbreviation: "TM" },
  { orderCode: "OF 2", orderFamilyAbbreviation: "GC" },
  { orderCode: "OF 1", orderFamilyAbbreviation: null },
  { orderCode: "OF 4", orderFamilyAbbreviation: "GC" },
];

describe("filterAndSortByOrderFamily", () => {
  it("filtra por abreviação ignorando maiúsculas/minúsculas", () => {
    expect(filterAndSortByOrderFamily(ROWS, "gC", "asc", false).map((row) => row.orderCode)).toEqual([
      "OF 2",
      "OF 4",
    ]);
  });

  it("ordena por abreviação e deixa OFs sem família no fim", () => {
    expect(filterAndSortByOrderFamily(ROWS, "", "asc", true).map((row) => row.orderCode)).toEqual([
      "OF 2",
      "OF 4",
      "OF 3",
      "OF 1",
    ]);
    expect(filterAndSortByOrderFamily(ROWS, "", "desc", true).map((row) => row.orderCode)).toEqual([
      "OF 3",
      "OF 2",
      "OF 4",
      "OF 1",
    ]);
  });
});
