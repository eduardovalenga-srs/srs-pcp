import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({ id: "user-1", role: "GESTOR" })),
  createClient: vi.fn(async () => ({ name: "client" })),
  revalidatePath: vi.fn(),
  // production.repository — processo alvo, escrita e histórico.
  getProductionProcessById: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  updateProductionProcess: vi.fn<(client: unknown, id: string, changes: unknown) => Promise<void>>(),
  updateProductionProcessesStatus: vi.fn<
    (client: unknown, ids: readonly string[], status: string) => Promise<void>
  >(),
  insertProductionEvents: vi.fn<(client: unknown, events: unknown[]) => Promise<void>>(),
  // production.repository — alvos da edição em lote por OF (025).
  getOrderProcessTargets: vi.fn<
    (client: unknown, orderId: string, processCode: string) => Promise<unknown[]>
  >(),
  // order-items.repository — cadeia da cascata, derivação e refresh.
  getItemProcessChains: vi.fn<
    (client: unknown, itemIds: readonly string[], options: unknown) => Promise<Map<string, unknown>>
  >(),
  getItemProcessChain: vi.fn<(client: unknown, orderItemId: string) => Promise<unknown[]>>(),
  getItemProcessChainWithChildren: vi.fn<
    (client: unknown, orderItemId: string) => Promise<unknown[]>
  >(),
  getItemAggregates: vi.fn<
    (client: unknown, itemIds: readonly string[]) => Promise<Map<string, unknown>>
  >(),
  refreshOrderStatusesBulk: vi.fn<
    (client: unknown, updates: unknown[]) => Promise<void>
  >(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/repositories/production.repository", () => ({
  getProductionProcessById: mocks.getProductionProcessById,
  updateProductionProcess: mocks.updateProductionProcess,
  updateProductionProcessesStatus: mocks.updateProductionProcessesStatus,
  insertProductionEvents: mocks.insertProductionEvents,
  getOrderProcessTargets: mocks.getOrderProcessTargets,
}));
vi.mock("@/lib/repositories/order-items.repository", () => ({
  getItemProcessChains: mocks.getItemProcessChains,
  getItemProcessChain: mocks.getItemProcessChain,
  getItemProcessChainWithChildren: mocks.getItemProcessChainWithChildren,
  getItemAggregates: mocks.getItemAggregates,
  refreshOrderStatusesBulk: mocks.refreshOrderStatusesBulk,
}));

import { updateProcessAction, updateProcessBatchAction } from "@/lib/actions/production.actions";

type CurrentProcess = {
  id: string;
  orderItemId: string;
  status: string;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
  process: { code: string; name: string };
  item: { description: string; quantity: number };
};

/** Registro do processo alvo no formato de `getProductionProcessById`. */
function currentProcess(overrides: Partial<CurrentProcess> = {}): CurrentProcess {
  return {
    id: "pp-kit",
    orderItemId: "item-1",
    status: "NAO_INICIADO",
    quantityPlanned: 10,
    quantityCompleted: 0,
    notes: null,
    process: { code: "KIT", name: "KIT" },
    item: { description: "Portão 4m", quantity: 2 },
    ...overrides,
  };
}

type ChainProcess = {
  id: string;
  orderItemId: string;
  status: string;
  code: string;
  displayOrder: number;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
};

/** Elemento da cadeia no formato de `getItemProcessChain`. */
function chainProcess(
  id: string,
  code: string,
  displayOrder: number,
  status: string,
  overrides: Partial<ChainProcess> = {},
): ChainProcess {
  return {
    id,
    orderItemId: "item-1",
    status,
    code,
    displayOrder,
    quantityPlanned: 10,
    quantityCompleted: 0,
    notes: null,
    ...overrides,
  };
}

/** Alvo do lote no formato de `OrderProcessTarget`. */
function target(id: string, orderItemId: string, status: string) {
  return { id, orderItemId, status, quantityPlanned: 10, quantityCompleted: 0, notes: null };
}

describe("cascata da linha do tempo (regra 62 revisada)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ id: "user-1", role: "GESTOR" });
    mocks.createClient.mockResolvedValue({ name: "client" });
    mocks.getProductionProcessById.mockResolvedValue(null);
    mocks.updateProductionProcess.mockResolvedValue(undefined);
    mocks.updateProductionProcessesStatus.mockResolvedValue(undefined);
    mocks.insertProductionEvents.mockResolvedValue(undefined);
    mocks.getOrderProcessTargets.mockResolvedValue([]);
    mocks.getItemProcessChains.mockResolvedValue(new Map());
    mocks.getItemProcessChain.mockResolvedValue([]);
    mocks.getItemProcessChainWithChildren.mockResolvedValue([]);
    mocks.getItemAggregates.mockResolvedValue(new Map());
    mocks.refreshOrderStatusesBulk.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exige a capacidade production.update_status", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("Permissão negada."));

    const result = await updateProcessAction({
      productionProcessId: "pp-1",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Permissão negada.");
  });

  it("ao concluir, puxa os predecessores não iniciados (edição unitária)", async () => {
    mocks.getProductionProcessById.mockResolvedValue(currentProcess());
    mocks.getItemProcessChainWithChildren.mockResolvedValue([
      chainProcess("pp-mp", "MP", 5, "NAO_INICIADO"),
      chainProcess("pp-laser", "LASER", 10, "CONCLUIDO"),
      chainProcess("pp-dbch", "DB_CH", 20, "NAO_INICIADO"),
      chainProcess("pp-serra", "SERRA", 30, "NAO_APLICAVEL"),
      chainProcess("pp-kit", "KIT", 70, "CONCLUIDO"),
    ]);
    mocks.getItemAggregates.mockResolvedValue(
      new Map([
        ["item-1", { status: "PLANEJADO", op: "OP-1", processStatuses: ["CONCLUIDO"] }],
      ]),
    );

    const result = await updateProcessAction({
      productionProcessId: "pp-kit",
      status: "CONCLUIDO",
      quantityPlanned: 10,
      quantityCompleted: 0,
      notes: null,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    // 056: o MP ficou fora da linha do tempo — só o DB CH é puxado.
    expect(result.message).toContain("+1 concluído automaticamente");

    // alvo pelo fluxo unitário; DB CH (e só ele) pela cascata em lote —
    // MP fora da cascata; SERRA fora da linha do tempo; LASER já concluído.
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-kit",
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["pp-dbch"],
      "CONCLUIDO",
    );
    // o MP NUNCA é tocado pela cascata (espelho do recebimento).
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["pp-mp"]),
      expect.anything(),
    );

    // alvo + cascata no mesmo INSERT, com a nota de automação
    expect(mocks.insertProductionEvents).toHaveBeenCalledTimes(1);
    expect(mocks.insertProductionEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ productionProcessId: "pp-kit" }),
        expect.objectContaining({
          productionProcessId: "pp-dbch",
          oldStatus: "NAO_INICIADO",
          newStatus: "CONCLUIDO",
          notes: "Concluído automaticamente ao concluir KIT",
        }),
      ]),
    );

    // a cascata roda ANTES da re-derivação do status do item
    expect(mocks.getItemProcessChainWithChildren.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getItemAggregates.mock.invocationCallOrder[0],
    );
    expect(mocks.refreshOrderStatusesBulk).toHaveBeenCalledWith(expect.anything(), [
      { itemId: "item-1", status: "CONCLUIDO" },
    ]);
  });

  it("090: concluir um processo de Fábrica 2 puxa a cadeia F1/KIT dos itens filhos", async () => {
    mocks.getProductionProcessById.mockResolvedValue(
      currentProcess({
        id: "pp-acab",
        status: "NAO_INICIADO",
        process: { code: "ACAB", name: "ACAB" },
      }),
    );
    // Cadeia CONJUNTA (090): item raiz (MP/PRÉ-MTG/ACAB) + filhos (F1 + KIT).
    mocks.getItemProcessChainWithChildren.mockResolvedValue([
      chainProcess("root-mp", "MP", 5, "NAO_INICIADO", { orderItemId: "item-1" }),
      chainProcess("root-premtg", "PRE_MTG", 80, "NAO_INICIADO", { orderItemId: "item-1" }),
      chainProcess("pp-acab", "ACAB", 100, "CONCLUIDO", { orderItemId: "item-1" }),
      chainProcess("child-laser", "LASER", 10, "NAO_INICIADO", { orderItemId: "child-1" }),
      chainProcess("child-kit", "KIT", 70, "NAO_INICIADO", { orderItemId: "child-1" }),
      chainProcess("child2-laser", "LASER", 10, "CONCLUIDO", { orderItemId: "child-2" }),
      chainProcess("child2-kit", "KIT", 70, "NAO_INICIADO", { orderItemId: "child-2" }),
    ]);
    mocks.getItemAggregates.mockResolvedValue(
      new Map([
        ["item-1", { status: "EM_PRODUCAO", op: "OP-1", processStatuses: ["CONCLUIDO"] }],
        ["child-1", { status: "EM_PRODUCAO", op: "OP-1", processStatuses: ["CONCLUIDO"] }],
        ["child-2", { status: "EM_PRODUCAO", op: "OP-1", processStatuses: ["CONCLUIDO"] }],
      ]),
    );

    const result = await updateProcessAction({
      productionProcessId: "pp-acab",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(true);
    // LASER/KIT dos dois filhos + PRÉ-MTG do raiz (o LASER do child-2 já
    // estava concluído e o MP fica fora da cascata).
    expect(result.message).toContain("+4 concluídos automaticamente");

    // Alvo no fluxo unitário; a cascata inteira em um único UPDATE.
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-acab",
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["child-laser", "child-kit", "child2-kit", "root-premtg"],
      "CONCLUIDO",
    );
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["root-mp"]),
      expect.anything(),
    );

    // Cada processo puxado pela F1 registra seu evento com a nota de automação.
    expect(mocks.insertProductionEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          productionProcessId: "child-kit",
          oldStatus: "NAO_INICIADO",
          newStatus: "CONCLUIDO",
          notes: "Concluído automaticamente ao concluir ACAB",
        }),
      ]),
    );

    // O status agregado dos FILHOS também é re-derivado — tudo em uma RPC.
    expect(mocks.getItemAggregates).toHaveBeenCalledWith(expect.anything(), [
      "item-1",
      "child-1",
      "child-2",
    ]);
    expect(mocks.refreshOrderStatusesBulk).toHaveBeenCalledWith(expect.anything(), [
      { itemId: "item-1", status: "CONCLUIDO" },
      { itemId: "child-1", status: "CONCLUIDO" },
      { itemId: "child-2", status: "CONCLUIDO" },
    ]);
  });

  it("sem mudança de situação não dispara cascata", async () => {
    mocks.getProductionProcessById.mockResolvedValue(currentProcess({ status: "CONCLUIDO" }));

    const result = await updateProcessAction({
      productionProcessId: "pp-kit",
      status: "CONCLUIDO",
      quantityPlanned: 10,
      quantityCompleted: 0,
      notes: null,
    });

    expect(result.changed).toBe(false);
    expect(result.message).toBe("Nenhuma alteração para salvar.");
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
    expect(mocks.getItemProcessChain).not.toHaveBeenCalled();
  });

  it("ao voltar a NAO_INICIADO saindo de CONCLUIDO, reinicia a linha (antes e depois)", async () => {
    mocks.getProductionProcessById.mockResolvedValue(
      currentProcess({
        id: "pp-solda",
        status: "CONCLUIDO",
        quantityPlanned: 4,
        quantityCompleted: 4,
        notes: "ok",
        process: { code: "SOLDA", name: "SOLDA" },
      }),
    );
    mocks.getItemProcessChain.mockResolvedValue([
      chainProcess("pp-mp", "MP", 5, "CONCLUIDO"),
      chainProcess("pp-solda", "SOLDA", 90, "NAO_INICIADO"),
      chainProcess("pp-acab", "ACAB", 100, "CONCLUIDO"),
      chainProcess("pp-quality", "QUALITY", 110, "NAO_APLICAVEL"),
      chainProcess("pp-exp", "EXP", 120, "CONCLUIDO"),
    ]);
    mocks.getItemAggregates.mockResolvedValue(
      new Map([
        ["item-1", { status: "CONCLUIDO", op: "OP-1", processStatuses: ["NAO_INICIADO"] }],
      ]),
    );

    const result = await updateProcessAction({
      productionProcessId: "pp-solda",
      status: "NAO_INICIADO",
      quantityPlanned: 4,
      quantityCompleted: 4,
      notes: "ok",
    });

    expect(result.success).toBe(true);
    // 056: o MP ficou fora da linha do tempo — só ACAB e EXP voltam.
    expect(result.message).toContain("2 processos devolvidos");

    // a linha reinicia: alvo no fluxo unitário + ACAB e EXP (depois) em
    // lote — MP intocado; QUALITY não aplicável fica de fora.
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-solda",
      expect.objectContaining({ status: "NAO_INICIADO" }),
    );
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["pp-acab", "pp-exp"],
      "NAO_INICIADO",
    );
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["pp-mp"]),
      expect.anything(),
    );
    expect(mocks.insertProductionEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          productionProcessId: "pp-exp",
          oldStatus: "CONCLUIDO",
          newStatus: "NAO_INICIADO",
          notes: "Devolvido a não iniciado ao desmarcar SOLDA",
        }),
      ]),
    );
    expect(mocks.refreshOrderStatusesBulk).toHaveBeenCalledWith(expect.anything(), [
      { itemId: "item-1", status: "EM_PRODUCAO" },
    ]);
  });

  it("entrar como NAO_INICIADO vindo de NAO_APLICAVEL não mexe nos sucessores", async () => {
    mocks.getProductionProcessById.mockResolvedValue(
      currentProcess({
        id: "pp-laser",
        status: "NAO_APLICAVEL",
        quantityPlanned: 3,
        process: { code: "LASER", name: "LASER" },
      }),
    );

    const result = await updateProcessAction({
      productionProcessId: "pp-laser",
      status: "NAO_INICIADO",
      quantityPlanned: 3,
      quantityCompleted: 0,
      notes: null,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-laser",
      expect.objectContaining({ status: "NAO_INICIADO" }),
    );
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalled();
    expect(mocks.getItemProcessChain).not.toHaveBeenCalled();
  });

  it("lote para CONCLUIDO dispara a cascata em cada item atingido", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-s1", "item-1", "NAO_INICIADO"),
      target("pp-s2", "item-2", "NAO_INICIADO"),
    ]);
    mocks.getItemProcessChains.mockResolvedValue(
      new Map([
        [
          "item-1",
          [
            chainProcess("pp-mp1", "MP", 5, "NAO_INICIADO"),
            chainProcess("pp-s1", "SOLDA", 90, "CONCLUIDO"),
          ],
        ],
        [
          "item-2",
          [
            chainProcess("pp-mp2", "MP", 5, "CONCLUIDO", { orderItemId: "item-2" }),
            chainProcess("pp-s2", "SOLDA", 90, "CONCLUIDO", { orderItemId: "item-2" }),
          ],
        ],
      ]),
    );

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);
    // 056: o MP ficou fora da cascata — sem ele, não há nada a puxar.
    expect(result.message).toBe("SOLDA → concluído em 2 de 2 itens.");

    // alvos do lote em um único UPDATE; o MP do item-1 fica intocado
    // (espelho do recebimento registrado em /recebimento-mp).
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["pp-s1", "pp-s2"],
      "CONCLUIDO",
    );
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["pp-mp1"]),
      expect.anything(),
    );
    expect(mocks.insertProductionEvents).toHaveBeenCalledTimes(1);

    // cadeia lida dos dois itens de UMA vez e sempre ANTES da re-derivação
    expect(mocks.getItemProcessChains).toHaveBeenCalledTimes(1);
    expect(mocks.getItemProcessChains).toHaveBeenCalledWith(
      expect.anything(),
      ["item-1", "item-2"],
      { includeChildren: true },
    );
    expect(mocks.getItemAggregates).toHaveBeenCalledTimes(1);
    expect(mocks.getItemProcessChains.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getItemAggregates.mock.invocationCallOrder[0],
    );
  });

  it("lote para NAO_INICIADO reinicia a linha dos itens reabertos", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-s1", "item-1", "CONCLUIDO"),
      target("pp-s2", "item-2", "NAO_INICIADO"),
    ]);
    mocks.getItemProcessChains.mockResolvedValue(
      new Map([
        [
          "item-1",
          [
            chainProcess("pp-mp1", "MP", 5, "CONCLUIDO"),
            chainProcess("pp-s1", "SOLDA", 90, "NAO_INICIADO"),
            chainProcess("pp-acab1", "ACAB", 100, "CONCLUIDO"),
          ],
        ],
      ]),
    );

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "NAO_INICIADO",
    });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    // 056: o MP ficou fora da linha do tempo — só o ACAB é devolvido.
    expect(result.message).toContain("1 processo devolvido");

    // só o item-1 mudou: alvo + ACAB em um único UPDATE (MP intocado).
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["pp-s1", "pp-acab1"],
      "NAO_INICIADO",
    );
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["pp-mp1"]),
      expect.anything(),
    );
    expect(mocks.getItemProcessChains).toHaveBeenCalledTimes(1);
    expect(mocks.getItemProcessChains).toHaveBeenCalledWith(
      expect.anything(),
      ["item-1"],
      { includeChildren: false },
    );
    expect(mocks.insertProductionEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          productionProcessId: "pp-acab1",
          notes: "Devolvido a não iniciado ao desmarcar SOLDA",
        }),
      ]),
    );
  });

  it("lote para NAO_APLICAVEL não dispara cascata", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([target("pp-s1", "item-1", "NAO_INICIADO")]);

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "NAO_APLICAVEL",
    });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    // nenhuma menção a automação na mensagem e nenhum passo de cascata
    expect(result.message).not.toContain(" · ");
    expect(mocks.getItemProcessChain).not.toHaveBeenCalled();
    expect(mocks.getItemProcessChains).not.toHaveBeenCalled();
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["pp-s1"],
      "NAO_APLICAVEL",
    );
  });
});
