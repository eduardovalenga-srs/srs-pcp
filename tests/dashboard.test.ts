import { describe, expect, it } from "vitest";

import { computeOrderAging, computeTopCustomers } from "@/lib/utils/dashboard";

describe("computeTopCustomers", () => {
  it("ordena por volume e devolve o top N", () => {
    const rows = [
      { customerName: "Metalúrgica Alfa" },
      { customerName: "Metalúrgica Alfa" },
      { customerName: "Construtora Beta" },
      { customerName: "Construtora Beta" },
      { customerName: "Construtora Beta" },
      { customerName: "Serralheria Gama" },
    ];
    expect(computeTopCustomers(rows)).toEqual([
      { name: "Construtora Beta", count: 3 },
      { name: "Metalúrgica Alfa", count: 2 },
      { name: "Serralheria Gama", count: 1 },
    ]);
  });

  it("agrupa pedidos sem cliente em um rótulo único", () => {
    const rows = [{ customerName: null }, { customerName: "   " }, { customerName: "Cliente X" }];
    expect(computeTopCustomers(rows, 10)).toEqual([
      { name: "Sem cliente", count: 2 },
      { name: "Cliente X", count: 1 },
    ]);
  });

  it("respeita o limite informado", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ customerName: `C${index}` }));
    expect(computeTopCustomers(rows, 3)).toHaveLength(3);
  });
});

describe("computeOrderAging", () => {
  const today = "2026-10-01";

  it("só considera pedidos em aberto (PLANEJADO/EM_PRODUCAO)", () => {
    const buckets = computeOrderAging(
      [
        { orderDate: "2026-09-28", status: "CONCLUIDO" },
        { orderDate: "2026-09-28", status: "CANCELADO" },
        { orderDate: "2026-09-28", status: "EM_PRODUCAO" },
      ],
      today,
    );
    expect(buckets.find((bucket) => bucket.key === "0-7")?.count).toBe(1);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
  });

  it("classifica a idade do pedido nas faixas corretas", () => {
    const buckets = computeOrderAging(
      [
        { orderDate: "2026-10-01", status: "PLANEJADO" }, // 0 dias
        { orderDate: "2026-09-24", status: "PLANEJADO" }, // 7 dias
        { orderDate: "2026-09-23", status: "PLANEJADO" }, // 8 dias
        { orderDate: "2026-09-01", status: "PLANEJADO" }, // 30 dias
        { orderDate: "2026-08-01", status: "EM_PRODUCAO" }, // 61 dias
        { orderDate: "2026-01-01", status: "EM_PRODUCAO" }, // muito antigo
      ],
      today,
    );

    expect(buckets.find((bucket) => bucket.key === "0-7")?.count).toBe(2);
    expect(buckets.find((bucket) => bucket.key === "8-15")?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.key === "16-30")?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.key === "31-60")?.count).toBe(0);
    expect(buckets.find((bucket) => bucket.key === "60+")?.count).toBe(2);
  });

  it("separa pedidos sem data de abertura", () => {
    const buckets = computeOrderAging([{ orderDate: null, status: "PLANEJADO" }], today);
    expect(buckets.find((bucket) => bucket.key === "sem-data")?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.key === "0-7")?.count).toBe(0);
  });
});
