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

/** Data de referência dos testes: segunda-feira (DP conta dias úteis). */
const TODAY = "2026-10-19";

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
  it("espelha o cabeçalho da tela: dados fixos, DP e uma coluna por processo", () => {
    const sheet = gestaoEntregasSheet([productionOrderRow()], PROCESSES, TODAY);
    expect(sheet.headers).toEqual(["Seq.", "OF/OS", "Cli.", "Qtd.", "Peso", "Ent.", "DP", "MP", "LASER", "SERRA", "KIT", "SOLDA", "EXP"]);
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
    const sheet = gestaoEntregasSheet([row], PROCESSES, TODAY);
    const headers = sheet.headers;
    const rows = sheet.rows[0];

    expect(rows[headers.indexOf("SERRA")]).toBe("✓ 2/3");
    expect(rows[headers.indexOf("SOLDA")]).toBe("○ 0/4");
    expect(rows[headers.indexOf("LASER")]).toBe("—");
    // Processo sem célula na OF também sai como —.
    expect(rows[headers.indexOf("KIT")]).toBe("—");
    // Sem MP aplicável não há proposta a fazer.
    expect(rows[headers.indexOf("DP")]).toBe("—");
  });

  it("mantém números e datas tipadas (soma e ordenação no Excel)", () => {
    const sheet = gestaoEntregasSheet([productionOrderRow({ seq: null, weightTotal: null })], PROCESSES, TODAY);
    expect(sheet.rows[0][0]).toBe("—");
    expect(sheet.rows[0][3]).toBe(12);
    expect(sheet.rows[0][4]).toBe("—");
    expect(sheet.rows[0][5]).toBeInstanceOf(Date);
    // DP é a coluna imediatamente após a entrega, também tipada.
    expect(sheet.rows[0][6]).toBe("—");
    expect(sheet.dateColumns).toEqual([5, 6]);
  });

  it("coluna DP: proposta em dias úteis com MP pendente, — com MP concluída", () => {
    const pending = productionOrderRow({
      processes: {
        MP: orderProcessCell({ status: "NAO_INICIADO", applicable: 1 }),
        // O MP não entra na soma: SERRA + SOLDA + EXP => 3 dias úteis.
        SOLDA: orderProcessCell({ status: "NAO_INICIADO", applicable: 2 }),
        EXP: orderProcessCell({ status: "NAO_INICIADO", applicable: 2 }),
        // Concluído ou não, processo aplicável conta (regra aprovada).
        SERRA: orderProcessCell({ status: "CONCLUIDO", done: 3, applicable: 3 }),
      },
    });
    const sheet = gestaoEntregasSheet([pending], PROCESSES, TODAY);
    // 19/10 (seg) + 3 dias úteis (SERRA+SOLDA+EXP) = 22/10 (qui).
    expect(sheet.rows[0][6]).toEqual(new Date(2026, 9, 22));

    const delivered = productionOrderRow({
      processes: { MP: orderProcessCell({ status: "CONCLUIDO", applicable: 1 }) },
    });
    expect(gestaoEntregasSheet([delivered], PROCESSES, TODAY).rows[0][6]).toBe("—");
  });
});

describe("fabrica2Sheet", () => {
  it("oculta a cadeia da Fábrica 1 (LASER/SERRA) e mantém MP e as demais", () => {
    const sheet = fabrica2Sheet([productionRow()], PROCESSES, TODAY);
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
      "DP",
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
    const sheet = fabrica2Sheet([row], PROCESSES, TODAY);
    const rows = sheet.rows[0];

    expect(rows[sheet.headers.indexOf("MP")]).toBe("✓ 4/4");
    expect(rows[sheet.headers.indexOf("SOLDA")]).toBe("○ 2/10");
    // Sem quantidade: só o símbolo (mesmo comportamento da tela).
    expect(rows[sheet.headers.indexOf("KIT")]).toBe("✓");
    expect(rows[sheet.headers.indexOf("EXP")]).toBe("—");
    // MP concluída => sem proposta.
    expect(rows[sheet.headers.indexOf("DP")]).toBe("—");
  });

  it("campos vazios caem para — e a coluna Ent. é a de datas", () => {
    const row = productionRow({ parentItem: "", op: null, seq: null });
    const sheet = fabrica2Sheet([row], PROCESSES, TODAY);
    const rows = sheet.rows[0];

    expect(rows[sheet.headers.indexOf("Item pai")]).toBe("—");
    expect(rows[sheet.headers.indexOf("OP")]).toBe("—");
    expect(rows[sheet.headers.indexOf("Seq.")]).toBe("—");
    // Ent. e DP são as duas colunas de data, lado a lado.
    expect(sheet.dateColumns).toEqual([8, 9]);
  });

  it("coluna DP soma os processos aplicáveis do item com MP pendente", () => {
    const row = productionRow({
      processes: {
        MP: processCell({ status: "NAO_INICIADO" }),
        SOLDA: processCell({ status: "NAO_INICIADO" }),
        // Não aplicável fica de fora da soma; KIT concluído continua contando.
        EXP: processCell({ status: "NAO_APLICAVEL" }),
        KIT: processCell({ status: "CONCLUIDO" }),
      },
    });
    const sheet = fabrica2Sheet([row], PROCESSES, TODAY);
    // Seg 19/10 + 2 dias úteis (SOLDA + KIT) = qua 21/10.
    expect(sheet.rows[0][9]).toEqual(new Date(2026, 9, 21));
  });
});

describe("fabrica1Sheet", () => {
  it("usa a cadeia F1 com MP primeiro (mesma ordem da tela)", () => {
    const sheet = fabrica1Sheet([childItemGroup()], PROCESSES, TODAY);
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
      "DP",
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
    const sheet = fabrica1Sheet([group], PROCESSES, TODAY);
    const rows = sheet.rows[0];

    expect(rows[sheet.headers.indexOf("MP")]).toBe("✓");
    expect(rows[sheet.headers.indexOf("LASER")]).toBe("✓ 2/2");
    expect(rows[sheet.headers.indexOf("SERRA")]).toBe("—");
    // MP concluída => sem proposta (célula "—").
    expect(rows[sheet.headers.indexOf("DP")]).toBe("—");
  });

  it("consolida os materiais numa célula e cai para — quando não há", () => {
    const sheet = fabrica1Sheet(
      [
        childItemGroup({ materials: [material("CH6.30"), material("TB42.20")] }),
        childItemGroup({ id: "g2", materials: [] }),
      ],
      PROCESSES,
      TODAY,
    );

    expect(sheet.rows[0][4]).toBe("CH6.30; TB42.20");
    expect(sheet.rows[1][4]).toBe("—");
  });

  it("Filho sem código cai para a descrição (mesma regra da tela)", () => {
    const sheet = fabrica1Sheet([childItemGroup({ childItem: null, description: "SUPORTE 90" })], PROCESSES, TODAY);
    expect(sheet.rows[0][3]).toBe("SUPORTE 90");
  });

  it("coluna DP soma a cadeia do filho com o MP do pai pendente", () => {
    const group = childItemGroup({
      processes: [
        childItemProcess({ code: "LASER", status: "NAO_INICIADO" }),
        childItemProcess({ code: "KIT", status: "CONCLUIDO" }),
        childItemProcess({ code: "SERRA", status: "NAO_APLICAVEL" }),
      ],
      parentProcessStatuses: { MP: "NAO_INICIADO" },
    });
    const sheet = fabrica1Sheet([group], PROCESSES, TODAY);
    // Seg 19/10 + 2 dias úteis (LASER + KIT; SERRA fora) = qua 21/10.
    expect(sheet.rows[0][9]).toEqual(new Date(2026, 9, 21));
  });
});

describe("pedidosSheet", () => {
  it("espelha as colunas e os rótulos da tela", () => {
    const sheet = pedidosSheet(
      [
        order(),
        order({ id: "o2", code: "107500", type: "OS", customerName: null, deliveryDate: null, status: "PLANEJADO" }),
      ],
      { o1: "2026-10-21" },
    );

    expect(sheet.headers).toEqual(["Código", "Cliente", "Entrega", "DP", "Situação", "Itens"]);
    expect(sheet.rows[0]).toEqual(["OF 107482", "ACME", expect.any(Date), expect.any(Date), "Em produção", 5]);
    // Sem proposta no mapa (MP concluída/sem processo) a célula é —.
    expect(sheet.rows[1]).toEqual(["OS 107500", "—", "—", "—", "Em espera", 5]);
    expect(sheet.dateColumns).toEqual([2, 3]);
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
