import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";
import { parseExcelFile } from "@/lib/import/excel-parser";
import { buildOfStructure } from "@/lib/import/of-structure";

let db: PGlite;
let close: () => Promise<void>;
let gestorId: string;

beforeAll(async () => {
  const testDb = await createTestDatabase();
  db = testDb.db;
  close = testDb.close;
  gestorId = await createUser(db, "gestor@empresa.com", "GESTOR");
}, 120_000);

afterAll(async () => {
  await close();
});

describe("REPRO: importação real -> materiais", () => {
  it("grava os materiais dos filhos no banco", async () => {
    const fixturePath = path.join(process.cwd(), "tests", "fixtures", "of-107482-novo-layout.xlsx");
    const buffer = readFileSync(fixturePath);
    const parsed = parseExcelFile(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      "OF 107482.xlsx",
      buffer.byteLength,
    );
    const detected = parsed.sheets.filter((entry) => parsed.headerBySheet[entry.name]?.detected)[0]!;
    const { orders } = buildOfStructure(detected, { customerName: "ACME", deliveryDate: "2026-12-15" });

    // Mapa do que o parser produziu: por filho, quantos materiais.
    const builtChildMaterials = new Map<string, number>();
    for (const order of orders) {
      for (const parent of order.parents) {
        for (const child of parent.children) {
          builtChildMaterials.set(`${order.code}::${child.code}`, child.materials.length);
        }
      }
    }

    const operations = orders
      .filter((order) => !order.issues.some((issue) => issue.severity === "error"))
      .map((order) => ({
        action: "CREATE",
        order: {
          code: order.code,
          type: order.type,
          customerName: order.customerName,
          description: order.description,
          deliveryDate: order.deliveryDate,
        },
        parents: order.parents,
      }));

    await asUser(db, "authenticated", gestorId);
    const { rows: resultRows } = await db.query<{ result: Record<string, number> }>(
      "select public.apply_of_import($1::jsonb) as result",
      [JSON.stringify({ operations })],
    );
    console.log("apply_of_import:", JSON.stringify(resultRows[0]?.result));

    const { rows: dbChildren } = await db.query<{
      code: string;
      child: string | null;
      mats: string;
    }>(
      `select o.code, oi.parent_item as child, count(m.id)::text as mats
         from public.orders o
         join public.order_items oi on oi.order_id = o.id and oi.parent_order_item_id is not null
         left join public.order_item_materials m on m.order_item_id = oi.id
        group by o.code, oi.parent_item
        order by o.code, oi.parent_item`,
    );

    const discrepancies: string[] = [];
    for (const row of dbChildren) {
      const key = `${row.code}::${row.child}`;
      const built = builtChildMaterials.get(key) ?? 0;
      if (Number(row.mats) !== built) {
        discrepancies.push(`${key}: arquivo=${built} banco=${row.mats}`);
      }
    }

    console.log("filhos no banco:", dbChildren.length, "com divergência:", discrepancies.length);
    if (discrepancies.length > 0) console.log(discrepancies.slice(0, 20).join("\n"));

    await asSuperUser(db);
    expect(discrepancies).toEqual([]);
  }, 120_000);
});
