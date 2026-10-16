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
  insertProductionEvent: vi.fn<(client: unknown, event: unknown) => Promise<void>>(),
  // production.repository — alvos da edição em lote por OF (025).
  getOrderProcessTargets: vi.fn<
    (client: unknown, orderId: string, processCode: string) => Promise<unknown[]>
  >(),
  // order-items.repository — cadeia da cascata, derivação e refresh.
  getItemAggregate: vi.fn<(client: unknown, itemId: string) => Promise<unknown>>(),
  getItemProcessChain: vi.fn<(client: unknown, orderItemId: string) => Promise<unknown[]>>(),
  refreshOrderStatuses: vi.fn<
    (client: unknown, orderItemId: string, status: string) => Promise<void>
  >(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/repositories/production.repository", () => ({
  getProductionProcessById: mocks.getProductionProcessById,
  updateProductionProcess: mocks.updateProductionProcess,
  insertProductionEvent: mocks.insertProductionEvent,
  getOrderProcessTargets: mocks.getOrderProcessTargets,
}));
vi.mock("@/lib/repositories/order-items.repository", () => ({
  getItemAggregate: mocks.getItemAggregate,
  getItemProcessChain: mocks.getItemProcessChain,
  refreshOrderStatuses: mocks.refreshOrderStatuses,
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
    mocks.insertProductionEvent.mockResolvedValue(undefined);
    mocks.getOrderProcessTargets.mockResolvedValue([]);
    mocks.getItemAggregate.mockResolvedValue(null);
    mocks.getItemProcessChain.mockResolvedValue([]);
    mocks.refreshOrderStatuses.mockResolvedValue(undefined);
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
    mocks.getItemProcessChain.mockResolvedValue([
      chainProcess("pp-mp", "MP", 5, "NAO_INICIADO"),
      chainProcess("pp-laser", "LASER", 10, "CONCLUIDO"),
      chainProcess("pp-dbch", "DB_CH", 20, "NAO_INICIADO"),
      chainProcess("pp-serra", "SERRA", 30, "NAO_APLICAVEL"),
      chainProcess("pp-kit", "KIT", 70, "CONCLUIDO"),
    ]);
    mocks.getItemAggregate.mockResolvedValue({
      status: "PLANEJADO",
      op: "OP-1",
      processStatuses: ["CONCLUIDO"],
    });

    const result = await updateProcessAction({
      productionProcessId: "pp-kit",
      status: "CONCLUIDO",
      quantityPlanned: 10,
      quantityCompleted: 0,
      notes: null,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.message).toContain("+2 concluídos automaticamente");

    // alvo + MP + DB CH (SERRA fora da linha do tempo; LASER já concluído)
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(3);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-kit",
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-mp",
      expect.objectContaining({ status: "CONCLUIDO", quantityPlanned: 10, notes: null }),
    );
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-dbch",
      expect.objectContaining({ status: "CONCLUIDO" }),
    );

    // um evento por processo, com a nota de automação
    expect(mocks.insertProductionEvent).toHaveBeenCalledTimes(3);
    expect(mocks.insertProductionEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productionProcessId: "pp-mp",
        oldStatus: "NAO_INICIADO",
        newStatus: "CONCLUIDO",
        notes: "Concluído automaticamente ao concluir KIT",
      }),
    );

    // a cascata roda ANTES da re-derivação do status do item
    expect(mocks.getItemProcessChain.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refreshOrderStatuses.mock.invocationCallOrder[0],
    );
    expect(mocks.refreshOrderStatuses).toHaveBeenCalledWith(expect.anything(), "item-1", "CONCLUIDO");
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
    mocks.getItemAggregate.mockResolvedValue({
      status: "CONCLUIDO",
      op: "OP-1",
      processStatuses: ["NAO_INICIADO"],
    });

    const result = await updateProcessAction({
      productionProcessId: "pp-solda",
      status: "NAO_INICIADO",
      quantityPlanned: 4,
      quantityCompleted: 4,
      notes: "ok",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("3 processos devolvidos");

    // a linha reinicia: alvo + MP (antes) + ACAB e EXP (depois);
    // QUALITY não aplicável fica de fora
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(4);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-mp",
      expect.objectContaining({ status: "NAO_INICIADO" }),
    );
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-acab",
      expect.objectContaining({ status: "NAO_INICIADO" }),
    );
    expect(mocks.insertProductionEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productionProcessId: "pp-exp",
        oldStatus: "CONCLUIDO",
        newStatus: "NAO_INICIADO",
        notes: "Devolvido a não iniciado ao desmarcar SOLDA",
      }),
    );
    expect(mocks.refreshOrderStatuses).toHaveBeenCalledWith(expect.anything(), "item-1", "EM_PRODUCAO");
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
    expect(mocks.getItemProcessChain).not.toHaveBeenCalled();
  });

  it("lote para CONCLUIDO dispara a cascata em cada item atingido", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-s1", "item-1", "NAO_INICIADO"),
      target("pp-s2", "item-2", "NAO_INICIADO"),
    ]);
    mocks.getItemProcessChain.mockImplementation(async (_client, orderItemId) =>
      orderItemId === "item-1"
        ? [
            chainProcess("pp-mp1", "MP", 5, "NAO_INICIADO"),
            chainProcess("pp-s1", "SOLDA", 90, "CONCLUIDO"),
          ]
        : [
            chainProcess("pp-mp2", "MP", 5, "CONCLUIDO"),
            chainProcess("pp-s2", "SOLDA", 90, "CONCLUIDO"),
          ],
    );
    mocks.getItemAggregate
      .mockResolvedValueOnce({ status: "PLANEJADO", op: null, processStatuses: ["NAO_INICIADO"] })
      .mockResolvedValueOnce({ status: "CONCLUIDO", op: null, processStatuses: ["CONCLUIDO"] });

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);
    expect(result.message).toContain("+1 concluído automaticamente");

    // alvos do lote + MP do item-1 (no item-2 o MP já estava concluído)
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(3);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-mp1",
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
    expect(mocks.insertProductionEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productionProcessId: "pp-mp1",
        notes: "Concluído automaticamente ao concluir SOLDA",
      }),
    );

    // cadeia lida dos dois itens e sempre ANTES da re-derivação
    expect(mocks.getItemProcessChain).toHaveBeenCalledTimes(2);
    expect(mocks.getItemAggregate).toHaveBeenCalledTimes(2);
    expect(mocks.getItemProcessChain.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getItemAggregate.mock.invocationCallOrder[0],
    );
  });

  it("lote para NAO_INICIADO reinicia a linha dos itens reabertos", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-s1", "item-1", "CONCLUIDO"),
      target("pp-s2", "item-2", "NAO_INICIADO"),
    ]);
    mocks.getItemProcessChain.mockResolvedValue([
      chainProcess("pp-mp1", "MP", 5, "CONCLUIDO"),
      chainProcess("pp-s1", "SOLDA", 90, "NAO_INICIADO"),
      chainProcess("pp-acab1", "ACAB", 100, "CONCLUIDO"),
    ]);
    mocks.getItemAggregate.mockResolvedValue(null);

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "NAO_INICIADO",
    });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.message).toContain("2 processos devolvidos");

    // só o item-1 mudou: alvo + MP e ACAB da linha; item-2 intocado
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(3);
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-mp1",
      expect.objectContaining({ status: "NAO_INICIADO" }),
    );
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(
      expect.anything(),
      "pp-acab1",
      expect.objectContaining({ status: "NAO_INICIADO" }),
    );
    expect(mocks.getItemProcessChain).toHaveBeenCalledTimes(1);
    expect(mocks.getItemProcessChain).toHaveBeenCalledWith(expect.anything(), "item-1");
    expect(mocks.insertProductionEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productionProcessId: "pp-acab1",
        notes: "Devolvido a não iniciado ao desmarcar SOLDA",
      }),
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
    expect(mocks.updateProductionProcess).toHaveBeenCalledTimes(1);
  });
});
