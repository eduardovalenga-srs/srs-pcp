import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({ id: "user-1", role: "GESTOR" })),
  createClient: vi.fn(async () => ({ name: "client" })),
  revalidatePath: vi.fn(),
  // production.repository — o alvo do lote vem do escopo por OF (025).
  getOrderProcessTargets: vi.fn<
    (client: unknown, orderId: string, processCode: string) => Promise<unknown[]>
  >(),
  // 092: escrita em lote (um UPDATE para todos os processos do lote).
  updateProductionProcessesStatus: vi.fn<
    (client: unknown, ids: readonly string[], status: string) => Promise<void>
  >(),
  insertProductionEvents: vi.fn<(client: unknown, events: unknown[]) => Promise<void>>(),
  // order-items.repository — re-derivação do status dos itens atingidos.
  getItemAggregates: vi.fn<
    (client: unknown, itemIds: readonly string[]) => Promise<Map<string, unknown>>
  >(),
  // 092: cadeias lidas de uma vez para todos os alvos da cascata.
  getItemProcessChains: vi.fn<
    (client: unknown, itemIds: readonly string[], options: unknown) => Promise<Map<string, unknown>>
  >(),
  refreshOrderStatusesBulk: vi.fn<(client: unknown, updates: unknown[]) => Promise<void>>(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/repositories/production.repository", () => ({
  getOrderProcessTargets: mocks.getOrderProcessTargets,
  updateProductionProcessesStatus: mocks.updateProductionProcessesStatus,
  insertProductionEvents: mocks.insertProductionEvents,
}));
vi.mock("@/lib/repositories/order-items.repository", () => ({
  getItemAggregates: mocks.getItemAggregates,
  getItemProcessChains: mocks.getItemProcessChains,
  refreshOrderStatusesBulk: mocks.refreshOrderStatusesBulk,
}));

import { updateProcessBatchAction } from "@/lib/actions/production.actions";

/** Alvos do lote no formato de OrderProcessTarget. */
function target(
  id: string,
  orderItemId: string,
  status: string,
  overrides: Partial<{
    quantityPlanned: number | null;
    quantityCompleted: number | null;
    notes: string | null;
  }> = {},
) {
  return {
    id,
    orderItemId,
    status,
    quantityPlanned: 10,
    quantityCompleted: 0,
    notes: null,
    ...overrides,
  };
}

describe("updateProcessBatchAction (025 — edição em lote por OF)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ id: "user-1", role: "GESTOR" });
    mocks.createClient.mockResolvedValue({ name: "client" });
    mocks.getOrderProcessTargets.mockResolvedValue([]);
    mocks.updateProductionProcessesStatus.mockResolvedValue(undefined);
    mocks.insertProductionEvents.mockResolvedValue(undefined);
    mocks.getItemAggregates.mockResolvedValue(new Map());
    mocks.getItemProcessChains.mockResolvedValue(new Map());
    mocks.refreshOrderStatusesBulk.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exige a capacidade production.update_status", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("Permissão negada."));

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Permissão");
    expect(mocks.getOrderProcessTargets).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejeita status inválido sem tocar no banco", async () => {
    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "FOO",
    });

    expect(result).toMatchObject({ success: false, message: "Status inválido." });
    expect(mocks.getOrderProcessTargets).not.toHaveBeenCalled();
  });

  it("MP é somente leitura: a edição em lote aponta para o Recebimento de MP", async () => {
    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "MP",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Recebimento de MP");
    expect(mocks.getOrderProcessTargets).not.toHaveBeenCalled();
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalled();
  });

  it("sem item aplicável na OF não grava nada", async () => {
    // Alvos só com NAO_APLICAVEL (célula "—" nunca é editável em lote).
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-1", "item-1", "NAO_APLICAVEL"),
    ]);

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Nenhum item");
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("aplica a situação só onde difere, preserva quantidades/observações e gera evento por item", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-1", "item-1", "NAO_INICIADO", { quantityPlanned: 3, quantityCompleted: 1, notes: "obs 1" }),
      // Já no status desejado: fora da gravação, mas conta no total.
      target("pp-2", "item-2", "CONCLUIDO", { quantityCompleted: 2 }),
      // Não aplicável: o lote nunca recria um processo desmarcado.
      target("pp-3", "item-3", "NAO_APLICAVEL"),
      target("pp-4", "item-4", "NAO_INICIADO"),
    ]);
    mocks.getItemAggregates.mockResolvedValue(
      new Map([
        [
          "item-1",
          {
            status: "EM_PRODUCAO",
            op: "OP-1",
            // Todos concluídos => o status derivado do item vira CONCLUIDO.
            processStatuses: ["CONCLUIDO"],
          },
        ],
        [
          "item-4",
          { status: "EM_PRODUCAO", op: null, processStatuses: ["CONCLUIDO"] },
        ],
      ]),
    );

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result).toMatchObject({ success: true, changed: true, updated: 2, total: 3 });
    expect(result.message).toContain("2 de 3");

    // 092: os dois itens que diferiam foram gravados em UM único UPDATE
    // (o NAO_APLICAVEL fica de fora) — só a situação muda; quantidades e
    // observações de cada processo são preservadas.
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateProductionProcessesStatus).toHaveBeenCalledWith(
      expect.anything(),
      ["pp-1", "pp-4"],
      "CONCLUIDO",
    );
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["pp-3"]),
      expect.anything(),
    );

    // Os eventos dos dois itens saem no mesmo INSERT, com a situação
    // anterior de cada um.
    expect(mocks.insertProductionEvents).toHaveBeenCalledTimes(1);
    expect(mocks.insertProductionEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        {
          productionProcessId: "pp-1",
          userId: "user-1",
          eventType: "STATUS_CHANGE",
          oldStatus: "NAO_INICIADO",
          newStatus: "CONCLUIDO",
          oldQuantity: 1,
          newQuantity: 1,
          notes: "obs 1",
        },
        expect.objectContaining({
          productionProcessId: "pp-4",
          oldStatus: "NAO_INICIADO",
          newStatus: "CONCLUIDO",
        }),
      ]),
    );

    // Status agregado re-derivado dos itens atingidos em uma única leitura
    // e uma única RPC.
    expect(mocks.getItemAggregates).toHaveBeenCalledTimes(1);
    expect(mocks.getItemAggregates).toHaveBeenCalledWith(expect.anything(), [
      "item-1",
      "item-4",
    ]);
    expect(mocks.refreshOrderStatusesBulk).toHaveBeenCalledTimes(1);
    expect(mocks.refreshOrderStatusesBulk).toHaveBeenCalledWith(expect.anything(), [
      { itemId: "item-1", status: "CONCLUIDO" },
      { itemId: "item-4", status: "CONCLUIDO" },
    ]);

    // Mudou algo => invalida as telas afetadas (inclusive a Fábrica 2).
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/gestao-entregas");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/fabrica-2");
  });

  it("nada mudou => changed false, sem gravação e sem revalidate", async () => {
    mocks.getOrderProcessTargets.mockResolvedValue([
      target("pp-1", "item-1", "CONCLUIDO", { quantityCompleted: 10 }),
    ]);

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result).toMatchObject({ success: true, changed: false, updated: 0, total: 1 });
    expect(mocks.updateProductionProcessesStatus).not.toHaveBeenCalled();
    expect(mocks.refreshOrderStatusesBulk).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("erro do banco vira mensagem amigável", async () => {
    mocks.getOrderProcessTargets.mockRejectedValue(new Error("Falha ao consultar a OF."));

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result).toMatchObject({ success: false, changed: false });
    expect(result.message).toContain("Falha ao consultar a OF.");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
