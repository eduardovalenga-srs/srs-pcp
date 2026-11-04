import { beforeEach, describe, expect, it, vi } from "vitest";

import { KIT_PROCESS_CODE, MP_PROCESS_CODE } from "@/lib/constants/processes";
import type {
  ChildItemGroup,
  ChildItemGroupMember,
  ChildItemProcess,
} from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import {
  buildChildItemGroup,
  isGroupProcessOverdue,
} from "@/lib/utils/child-item-groups";
import { parseChildItemFilters } from "@/lib/utils/filters";

/**
 * 052 — opção "Atrasados" dos filtros de PROCESSO da Fábrica 1:
 *
 *  - a REGRA: início previsto da janela anterior à data de referência e o
 *    processo ainda não concluído (a mesma data que a célula pinta de
 *    vermelho); por coluna ou por qualquer etapa editável (filtro do grupo,
 *    com o MP de fora);
 *  - o RECORTE: varredura do conjunto filtrado inteiro + página em memória,
 *    combinando por E com o "Atrasados" do card (regra do KIT, `atrasados=1`).
 *
 * Entrega em 2020 (janelas vencidas) e em 2099 (janela futura): os casos
 * ficam estáveis em qualquer data de execução.
 */

vi.mock("server-only", () => ({}));

const { listChildItemGroupsMock, getActiveProcessesMock } = vi.hoisted(() => ({
  listChildItemGroupsMock: vi.fn(),
  getActiveProcessesMock: vi.fn(),
}));

vi.mock("@/lib/repositories/order-items.repository", () => ({
  getOrderItemWithProcesses: vi.fn(),
  listChildItemGroups: listChildItemGroupsMock,
}));

vi.mock("@/lib/repositories/orders.repository", () => ({
  buildItemKey: vi.fn(),
  deleteOrder: vi.fn(),
  findItemsByOrderCodes: vi.fn(),
  findOrdersByCodes: vi.fn(),
  getOrderDetails: vi.fn(),
  getOrdersProcessRows: vi.fn(),
  listOrders: vi.fn(),
}));

vi.mock("@/lib/repositories/materials.repository", () => ({ replaceItemMaterials: vi.fn() }));
vi.mock("@/lib/repositories/import.repository", () => ({ applyPlan: vi.fn() }));
vi.mock("@/lib/repositories/production.repository", () => ({
  getActiveProcesses: getActiveProcessesMock,
}));

const { getChildItemsPage } = await import("@/lib/services/orders.service");

const CATALOG: ProcessDefinition[] = [
  { id: "p-mp", code: MP_PROCESS_CODE, name: MP_PROCESS_CODE, displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "p-laser", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "p-serra", code: "SERRA", name: "SERRA", displayOrder: 30, active: true, location: null, durationDays: 1 },
  { id: "p-kit", code: KIT_PROCESS_CODE, name: KIT_PROCESS_CODE, displayOrder: 80, active: true, location: null, durationDays: 2 },
  { id: "p-pre", code: "PRE_MTG", name: "PRE_MTG", displayOrder: 90, active: true, location: null, durationDays: 1 },
  { id: "p-exp", code: "EXP", name: "EXP", displayOrder: 130, active: true, location: null, durationDays: 1 },
];

/** Data de referência dos testes de regra (depois de 2020 e antes de 2099). */
const TODAY = "2026-10-20";

function process(
  code: string,
  status: ChildItemProcess["status"],
  extra: Partial<ChildItemProcess> = {},
): ChildItemProcess {
  return {
    id: `pp-${code}`,
    code,
    name: code,
    displayOrder: CATALOG.find((entry) => entry.code === code)?.displayOrder ?? 999,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    ...extra,
  };
}

function member(overrides: Partial<ChildItemGroupMember> = {}): ChildItemGroupMember {
  return {
    id: "m1",
    description: "SUPORTE 90",
    parentItem: "P-1",
    parentDescription: "GUARDA CORPO",
    parentDeliveryDate: "2026-10-20",
    parentProcessStatuses: { MP: "CONCLUIDO" },
    parentMpCompletedAt: null,
    quantity: 4,
    unitWeightKg: 1.5,
    deliveryDate: "2026-10-16",
    seq: null,
    processes: [process("LASER", "NAO_INICIADO"), process(KIT_PROCESS_CODE, "NAO_INICIADO")],
    materials: [],
    ...overrides,
  };
}

/** Linha agrupada (grupo de 1 membro) — `key` dá a chave/ids distintos. */
function group(overrides: Partial<ChildItemGroupMember> = {}, key = "CH-1"): ChildItemGroup {
  return buildChildItemGroup({
    order: { id: "o1", code: "OF-107482", customerName: "ACME" },
    key,
    childItem: key,
    members: [member(overrides)],
  });
}

describe("isGroupProcessOverdue — regra do filtro 'Atrasados' (052)", () => {
  it("marca o processo cujo início previsto já passou e que não concluiu", () => {
    // Entrega sexta 16/10: toda a cadeia vence antes de 20/10.
    expect(isGroupProcessOverdue(group(), CATALOG, "LASER", TODAY)).toBe(true);
    expect(isGroupProcessOverdue(group(), CATALOG, KIT_PROCESS_CODE, TODAY)).toBe(true);
  });

  it("não marca processo concluído, não aplicável, ausente ou sem entrega", () => {
    expect(
      isGroupProcessOverdue(
        group({ processes: [process("LASER", "CONCLUIDO"), process(KIT_PROCESS_CODE, "NAO_INICIADO")] }),
        CATALOG,
        "LASER",
        TODAY,
      ),
    ).toBe(false);
    expect(
      isGroupProcessOverdue(
        group({ processes: [process("LASER", "NAO_APLICAVEL"), process(KIT_PROCESS_CODE, "NAO_INICIADO")] }),
        CATALOG,
        "LASER",
        TODAY,
      ),
    ).toBe(false);
    // Processo que o grupo nem tem (coluna de outra cadeia).
    expect(isGroupProcessOverdue(group(), CATALOG, "SERRA", TODAY)).toBe(false);
    expect(
      isGroupProcessOverdue(group({ deliveryDate: null }), CATALOG, "LASER", TODAY),
    ).toBe(false);
    expect(
      isGroupProcessOverdue(group({ deliveryDate: "2099-01-02" }), CATALOG, "LASER", TODAY),
    ).toBe(false);
  });

  it("com 'ALL' vale qualquer etapa editável do grupo (o MP fica de fora)", () => {
    // LASER concluído, mas o KIT ainda vencido → atrasado no grupo.
    const laserOk = group({
      processes: [process("LASER", "CONCLUIDO"), process(KIT_PROCESS_CODE, "NAO_INICIADO")],
    });
    expect(isGroupProcessOverdue(laserOk, CATALOG, "ALL", TODAY)).toBe(true);

    // Tudo concluído/não aplicável: nenhum atraso.
    expect(
      isGroupProcessOverdue(
        group({
          processes: [process("LASER", "CONCLUIDO"), process(KIT_PROCESS_CODE, "CONCLUIDO")],
        }),
        CATALOG,
        "ALL",
        TODAY,
      ),
    ).toBe(false);

    // Só o MP vencido NÃO conta: a coluna MP desta tela mostra o PAI.
    const soMp = group({ processes: [process(MP_PROCESS_CODE, "NAO_INICIADO")] });
    expect(isGroupProcessOverdue(soMp, CATALOG, "ALL", TODAY)).toBe(false);
  });
});

describe("getChildItemsPage — filtro de processo 'Atrasados' (052)", () => {
  /** LASER e KIT vencidos (entrega 2020). */
  const atraso = group(
    {
      deliveryDate: "2020-01-10",
      quantity: 4,
      unitWeightKg: 1.5,
      processes: [process("LASER", "NAO_INICIADO"), process(KIT_PROCESS_CODE, "NAO_INICIADO")],
    },
    "atraso",
  );
  /** LASER já concluído (não conta na coluna LASER), KIT vencido. */
  const laserOk = group(
    {
      deliveryDate: "2020-01-10",
      quantity: 2,
      unitWeightKg: 2,
      processes: [process("LASER", "CONCLUIDO"), process(KIT_PROCESS_CODE, "NAO_INICIADO")],
    },
    "laser-ok",
  );
  /** KIT concluído (fora do card), LASER vencido (dentro dos processos). */
  const kitOk = group(
    {
      deliveryDate: "2020-01-10",
      quantity: 1,
      unitWeightKg: null,
      processes: [process("LASER", "NAO_INICIADO"), process(KIT_PROCESS_CODE, "CONCLUIDO")],
    },
    "kit-ok",
  );
  /** Entrega futura: nenhuma janela venceu. */
  const futuro = group(
    {
      deliveryDate: "2099-01-02",
      quantity: 10,
      unitWeightKg: 1,
      processes: [process("LASER", "NAO_INICIADO"), process(KIT_PROCESS_CODE, "NAO_INICIADO")],
    },
    "futuro",
  );

  const ALL_ROWS = [atraso, laserOk, kitOk, futuro];

  beforeEach(() => {
    listChildItemGroupsMock.mockReset();
    getActiveProcessesMock.mockReset();
    getActiveProcessesMock.mockResolvedValue(CATALOG);
    listChildItemGroupsMock.mockResolvedValue({
      items: ALL_ROWS,
      total: ALL_ROWS.length,
      qtyTotal: 17,
      weightTotal: 20,
    });
  });

  it("no grupo, recorta os grupos com QUALQUER etapa vencida", async () => {
    const page = await getChildItemsPage({} as never, parseChildItemFilters({ procsatrasado: "1" }));

    expect(page.items.map((item) => item.id)).toEqual([atraso.id, laserOk.id, kitOk.id]);
    expect(page.total).toBe(3);
    expect(page.qtyTotal).toBe(7); // 4 + 2 + 1
    expect(page.weightTotal).toBe(10); // 6 + 4 + 0 (kitOk sem peso)
    // Card "Atrasados" acompanha o recorte: regra do KIT sobre o conjunto
    // exibido — "kitOk" (KIT concluído) fica de fora.
    expect(page.kitOverdue).toEqual({ records: 2, qty: 6, weight: 10 });
  });

  it("na coluna, recorta só o processo escolhido (e o manda à RPC)", async () => {
    const page = await getChildItemsPage(
      {} as never,
      parseChildItemFilters({ processo: "LASER", procsatrasado: "1" }),
    );

    // A RPC já reduz o conjunto ao grupo que TEM o processo (situação =
    // ALL); o recorte de data continua em memória.
    expect(listChildItemGroupsMock).toHaveBeenCalled();
    const rpcFilters = listChildItemGroupsMock.mock.calls[0][1] as {
      processCode: string;
      processStatus: string;
    };
    expect(rpcFilters.processCode).toBe("LASER");
    expect(rpcFilters.processStatus).toBe("ALL");
    expect(listChildItemGroupsMock.mock.calls[0][2]).toBe("p-laser");

    // LASER vencido em "atraso" e "kitOk"; "laserOk" (LASER concluído) fica de fora.
    expect(page.items.map((item) => item.id)).toEqual([atraso.id, kitOk.id]);
    expect(page.total).toBe(2);
    expect(page.qtyTotal).toBe(5); // 4 + 1
  });

  it("pagina em memória sobre o recorte (a página da tela não vem da RPC)", async () => {
    const page = await getChildItemsPage(
      {} as never,
      parseChildItemFilters({ procsatrasado: "1", pagina: "2", porpagina: "2" }),
    );

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual([kitOk.id]);
    for (const call of listChildItemGroupsMock.mock.calls) {
      expect((call[1] as { pageSize: number }).pageSize).toBe(1000);
    }
  });

  it("combina por E com o 'Atrasados' do card (atrasados=1, regra do KIT)", async () => {
    const page = await getChildItemsPage(
      {} as never,
      parseChildItemFilters({ procsatrasado: "1", atrasados: "1" }),
    );

    // Interseção: etapa vencida E KIT vencido — "kitOk" sai aqui.
    expect(page.items.map((item) => item.id)).toEqual([atraso.id, laserOk.id]);
    expect(page.total).toBe(2);
    expect(page.qtyTotal).toBe(6); // 4 + 2
    expect(page.weightTotal).toBe(10); // 6 + 4
    // Com o card ligado, a lista É o recorte do KIT: o card bate com ela.
    expect(page.kitOverdue).toEqual({ records: 2, qty: 6, weight: 10 });
  });

  it("só o card (sem a opção de processo) mantém a regra do KIT de antes", async () => {
    const page = await getChildItemsPage({} as never, parseChildItemFilters({ atrasados: "1" }));

    expect(page.items.map((item) => item.id)).toEqual([atraso.id, laserOk.id]);
    expect(page.total).toBe(2);
    expect(page.kitOverdue).toEqual({ records: 2, qty: 6, weight: 10 });
  });

  it("sem nenhum recorte ligado, a página continua vindo da RPC (comportamento antigo)", async () => {
    const page = await getChildItemsPage({} as never, parseChildItemFilters({}));

    expect(page.items).toHaveLength(ALL_ROWS.length);
    // A varredura do card roda em paralelo e o número continua pela regra do KIT.
    expect(page.kitOverdue).toEqual({ records: 2, qty: 6, weight: 10 });
    expect(page.qtyTotal).toBe(17);
  });
});
