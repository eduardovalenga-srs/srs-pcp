import { describe, expect, it } from "vitest";

import type { ChildItemGroup, ChildItemProcess, OrderItemMaterial, OrderSummary } from "@/lib/types/order";
import type {
  OrderProcessCell,
  ProcessCell,
  ProcessDefinition,
  ProductionOrderRow,
  ProductionRow,
} from "@/lib/types/production";
import { collectAllPages, EXPORT_PAGE_SIZE } from "@/lib/export/common";
import {
  fabrica1Sheet,
  fabrica2Sheet,
  gestaoEntregasSheet,
  pedidosSheet,
} from "@/lib/export/columns";

/** Catálogo com a cadeia da Fábrica 1 + etapas da gestão (ordem real). */
const PROCESSES: ProcessDefinition[] = [
  { id: "p-mp", code: "MP", name: "Matéria-prima", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "p-laser", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "p-serra", code: "SERRA", name: "SERRA", displayOrder: 30, active: true, location: null, durationDays: 1 },
  { id: "p-kit", code: "KIT", name: "KIT", displayOrder: 80, active: true, location: null, durationDays: 1 },
  { id: "p-solda", code: "SOLDA", name: "SOLDA", displayOrder: 100, active: true, location: null, durationDays: 1 },
  { id: "p-exp", code: "EXP", name: "EXPEDIÇÃO", displayOrder: 130, active: true, location: null, durationDays: 1 },
];

function processCell(overrides: Partial<ProcessCell> = {}): ProcessCell {
  return {
    id: "pp1",
    status: "NAO_INICIADO",
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
    ...overrides,
  };
}

function orderProcessCell(overrides: Partial<OrderProcessCell> = {}): OrderProcessCell {
  return { status: "NAO_INICIADO", done: 0, applicable: 0, quantityPlanned: null, quantityCompleted: null, completedAt: null, ...overrides };
}

function productionOrderRow(overrides: Partial<ProductionOrderRow> = {}): ProductionOrderRow {
  return {
    orderId: "o1",
    orderCode: "107482",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    deliveryDate: "2026-10-20",
    quantity: 12,
    weightTotal: 33.5,
    overdue: false,
    seq: 7,
    processes: {},
    ...overrides,
  };
}

function productionRow(overrides: Partial<ProductionRow> = {}): ProductionRow {
  return {
    orderItemId: "i1",
    orderId: "o1",
    orderCode: "107482",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    family: "GC",
    parentItem: "P-1",
    description: "GUARDA CORPO",
    quantity: 4,
    unitWeightKg: 2.5,
    deliveryDate: "2026-10-20",
    itemStatus: "EM_PRODUCAO",
    op: "OP-12",
    overdue: false,
    seq: null,
    processes: {},
    ...overrides,
  };
}

function childItemProcess(overrides: Partial<ChildItemProcess> = {}): ChildItemProcess {
  return {
    id: "cp1",
    code: "LASER",
    name: "LASER",
    displayOrder: 10,
    status: "NAO_INICIADO",
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    ...overrides,
  };
}

function material(description: string): OrderItemMaterial {
  return { id: description, description, quantity: 2, unit: "UN", notes: null };
}

function childItemGroup(overrides: Partial<ChildItemGroup> = {}): ChildItemGroup {
  return {
    id: "g1",
    orderId: "o1",
    orderCode: "107482",
    customerName: "ACME",
    parentItem: "P-1",
    parentDescription: "GUARDA CORPO",
    parentItems: ["P-1"],
    childItem: "72ST18-025",
    description: "SUPORTE 90",
    memberCount: 1,
    memberIds: ["m1"],
    quantity: 2,
    unitWeightKg: 1.5,
    weightTotal: 3,
    deliveryDate: "2026-10-18",
    seq: 3,
    processes: [],
    parentProcessStatuses: { MP: "CONCLUIDO" },
    parentMpCompletedAt: "2026-10-12T10:00:00+00:00",
    parentDeliveryDate: "2026-10-20",
    materials: [],
    ...overrides,
  };
}

function order(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: "o1",
    code: "107482",
    type: "OF",
    customerName: "ACME",
    description: null,
    orderDate: "2026-10-01",
    deliveryDate: "2026-10-20",
    status: "EM_PRODUCAO",
    itemCount: 5,
    ...overrides,
  };
}

describe("gestaoEntregasSheet", () => {
  it("espelha o cabeçalho da tela: dados fixos + uma coluna por processo", () => {
    const sheet = gestaoEntregasSheet([productionOrderRow()], PROCESSES);
    expect(sheet.headers).toEqual(["Seq.", "OF/OS", "Cli.", "Qtd.", "Peso", "Ent.", "MP", "LASER", "SERRA", "KIT", "SOLDA", "EXP"]);
  });

  it("exporta célula agregada com contador e vazio como —", () => {
    const row = productionOrderRow({
      processes: {
        SERRA: orderProcessCell({ status: "CONCLUIDO", done: 2, applicable: 3 }),
        SOLDA: orderProcessCell({ status: "NAO_INICIADO", done: 0, applicable: 4 }),
        // applicable 0 => "—" na tela (etapa desmarcada para a OF inteira).
        LASER: orderProcessCell({ applicable: 0 }),
      },
    });
    const sheet = gestaoEntregasSheet([row], PROCESSES);
    const headers = sheet.headers;
    const rows = sheet.rows[0];

    expect(rows[headers.indexOf("SERRA")]).toBe("✓ 2/3");
    expect(rows[headers.indexOf("SOLDA")]).toBe("○ 0/4");
    expect(rows[headers.indexOf("LASER")]).toBe("—");
    // Processo sem célula na OF também sai como —.
    expect(rows[headers.indexOf("KIT")]).toBe("—");
  });

  it("mantém números e data tipados (soma e ordenação no Excel)", () => {
    const sheet = gestaoEntregasSheet([productionOrderRow({ seq: null, weightTotal: null })], PROCESSES);
    expect(sheet.rows[0][0]).toBe("—");
    expect(sheet.rows[0][3]).toBe(12);
    expect(sheet.rows[0][4]).toBe("—");
    expect(sheet.rows[0][5]).toBeInstanceOf(Date);
    expect(sheet.dateColumns).toEqual([5]);
  });
});

describe("fabrica2Sheet", () => {
  it("oculta a cadeia da Fábrica 1 (LASER/SERRA) e mantém MP e as demais", () => {
    const sheet = fabrica2Sheet([productionRow()], PROCESSES);
    expect(sheet.headers).toEqual([
      "Seq.",
      "OF/OS",
      "Cli.",
      "TP",
      "Item pai",
      "Desc.",
      "Qtd.",
      "Peso",
      "Ent.",
      "OP",
      "MP",
      "KIT",
      "SOLDA",
      "EXP",
    ]);
    expect(sheet.headers).not.toContain("LASER");
    expect(sheet.headers).not.toContain("SERRA");
  });

  it("célula de processo mostra símbolo + produzido/planejado", () => {
    const row = productionRow({
      processes: {
        MP: processCell({ status: "CONCLUIDO", quantityPlanned: 4, quantityCompleted: 4 }),
        SOLDA: processCell({ status: "NAO_INICIADO", quantityPlanned: 10, quantityCompleted: 2 }),
        KIT: processCell({ status: "CONCLUIDO" }),
      },
    });
    const sheet = fabrica2Sheet([row], PROCESSES);
    const rows = sheet.rows[0];

    expect(rows[sheet.headers.indexOf("MP")]).toBe("✓ 4/4");
    expect(rows[sheet.headers.indexOf("SOLDA")]).toBe("○ 2/10");
    // Sem quantidade: só o símbolo (mesmo comportamento da tela).
    expect(rows[sheet.headers.indexOf("KIT")]).toBe("✓");
    expect(rows[sheet.headers.indexOf("EXP")]).toBe("—");
  });

  it("campos vazios caem para — e a coluna Ent. é a de datas", () => {
    const row = productionRow({ parentItem: "", op: null, seq: null });
    const sheet = fabrica2Sheet([row], PROCESSES);
    const rows = sheet.rows[0];

    expect(rows[sheet.headers.indexOf("Item pai")]).toBe("—");
    expect(rows[sheet.headers.indexOf("OP")]).toBe("—");
    expect(rows[sheet.headers.indexOf("Seq.")]).toBe("—");
    expect(sheet.dateColumns).toEqual([8]);
  });
});

describe("fabrica1Sheet", () => {
  it("usa a cadeia F1 com MP primeiro (mesma ordem da tela)", () => {
    const sheet = fabrica1Sheet([childItemGroup()], PROCESSES);
    expect(sheet.headers).toEqual([
      "Seq.",
      "OF/OS",
      "Cli.",
      "Filho",
      "Matérias-primas",
      "Qtd.",
      "Peso un.",
      "Peso total",
      "Ent.",
      "MP",
      "LASER",
      "SERRA",
      "KIT",
    ]);
    // PRÉ-MTG/SOLDA/EXP ficam fora: moram na gestão de OF.
    expect(sheet.headers).not.toContain("SOLDA");
    expect(sheet.headers).not.toContain("EXP");
  });

  it("MP herda o status do item pai; etapa própria mostra contador", () => {
    const group = childItemGroup({
      processes: [
        childItemProcess({ code: "LASER", status: "CONCLUIDO", quantityPlanned: 2, quantityCompleted: 2 }),
      ],
      parentProcessStatuses: { MP: "CONCLUIDO" },
    });
    const sheet = fabrica1Sheet([group], PROCESSES);
    const rows = sheet.rows[0];

    expect(rows[sheet.headers.indexOf("MP")]).toBe("✓");
    expect(rows[sheet.headers.indexOf("LASER")]).toBe("✓ 2/2");
    expect(rows[sheet.headers.indexOf("SERRA")]).toBe("—");
  });

  it("consolida os materiais numa célula e cai para — quando não há", () => {
    const sheet = fabrica1Sheet(
      [
        childItemGroup({ materials: [material("CH6.30"), material("TB42.20")] }),
        childItemGroup({ id: "g2", materials: [] }),
      ],
      PROCESSES,
    );

    expect(sheet.rows[0][4]).toBe("CH6.30; TB42.20");
    expect(sheet.rows[1][4]).toBe("—");
  });

  it("Filho sem código cai para a descrição (mesma regra da tela)", () => {
    const sheet = fabrica1Sheet([childItemGroup({ childItem: null, description: "SUPORTE 90" })], PROCESSES);
    expect(sheet.rows[0][3]).toBe("SUPORTE 90");
  });
});

describe("pedidosSheet", () => {
  it("espelha as colunas e os rótulos da tela", () => {
    const sheet = pedidosSheet([
      order(),
      order({ id: "o2", code: "107500", type: "OS", customerName: null, deliveryDate: null, status: "PLANEJADO" }),
    ]);

    expect(sheet.headers).toEqual(["Código", "Cliente", "Entrega", "Situação", "Itens"]);
    expect(sheet.rows[0]).toEqual(["OF 107482", "ACME", expect.any(Date), "Em produção", 5]);
    expect(sheet.rows[1]).toEqual(["OS 107500", "—", "—", "Em espera", 5]);
    expect(sheet.dateColumns).toEqual([2]);
  });
});

describe("collectAllPages", () => {
  it("acumula páginas até o fim da lista", async () => {
    const pages = new Map([
      [1, Array.from({ length: EXPORT_PAGE_SIZE }, (_, index) => index)],
      [2, Array.from({ length: 500 }, (_, index) => index)],
    ]);
    const requested: number[] = [];

    const rows = await collectAllPages(async (page) => {
      requested.push(page);
      const pageRows = pages.get(page) ?? [];
      return { rows: pageRows, total: EXPORT_PAGE_SIZE + 500 };
    });

    expect(requested).toEqual([1, 2]);
    expect(rows).toHaveLength(EXPORT_PAGE_SIZE + 500);
  });

  it("para quando o total já foi alcançado (lista vazia inclusive)", async () => {
    const rows = await collectAllPages(async () => ({ rows: [], total: 0 }));
    expect(rows).toEqual([]);
  });

  it("para quando uma página volta incompleta", async () => {
    let calls = 0;
    const rows = await collectAllPages(async () => {
      calls += 1;
      return { rows: Array.from({ length: EXPORT_PAGE_SIZE }, (_, index) => index), total: 999_999 };
    });
    // Sempre página cheia, mas o teto de páginas segura o loop.
    expect(calls).toBeLessThanOrEqual(100);
    expect(rows.length).toBeGreaterThan(0);
  });
});
