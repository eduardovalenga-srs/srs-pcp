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
  updateProductionProcess: vi.fn<
    (client: unknown, id: string, changes: unknown) => Promise<void>
  >(),
  insertProductionEvent: vi.fn<(client: unknown, event: unknown) => Promise<void>>(),
  // order-items.repository — re-derivação do status do item atingido.
  getItemAggregate: vi.fn<(client: unknown, itemId: string) => Promise<unknown>>(),
  refreshOrderStatuses: vi.fn<
    (client: unknown, orderItemId: string, status: string) => Promise<void>
  >(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/repositories/production.repository", () => ({
  getOrderProcessTargets: mocks.getOrderProcessTargets,
  updateProductionProcess: mocks.updateProductionProcess,
  insertProductionEvent: mocks.insertProductionEvent,
}));
vi.mock("@/lib/repositories/order-items.repository", () => ({
  getItemAggregate: mocks.getItemAggregate,
  refreshOrderStatuses: mocks.refreshOrderStatuses,
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
    mocks.updateProductionProcess.mockResolvedValue(undefined);
    mocks.insertProductionEvent.mockResolvedValue(undefined);
    mocks.getItemAggregate.mockResolvedValue(null);
    mocks.refreshOrderStatuses.mockResolvedValue(undefined);
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

  it("MP é portão de duas posições: só NAO_INICIADO e CONCLUIDO", async () => {
    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "MP",
      status: "NAO_APLICAVEL",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("apenas as situações");
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
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
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
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
    mocks.getItemAggregate.mockImplementation(async () => ({
      status: "EM_PRODUCAO" as const,
      op: "OP-1",
      // Todos concluídos => o status derivado do item vira CONCLUIDO.
      processStatuses: ["CONCLUIDO" as const],
    }));

    const result = await updateProcessBatchAction({
      orderId: "of-1",
      processCode: "SOLDA",
      status: "CONCLUIDO",
    });

    expect(result).toMatchObject({ success: true, changed: true, updated: 2, total: 3 });
    expect(result.message).toContain("2 de 3");

    // Só os itens que diferiam foram regravados (o NAO_APLICAVEL fica de fora).
    const updatedIds = mocks.updateProductionProcess.mock.calls.map(([, id]) => id);
    expect(updatedIds.sort()).toEqual(["pp-1", "pp-4"]);

    // Apenas a situação muda: quantidades e observações são preservadas.
    expect(mocks.updateProductionProcess).toHaveBeenCalledWith(expect.anything(), "pp-1", {
      status: "CONCLUIDO",
      quantityPlanned: 3,
      quantityCompleted: 1,
      notes: "obs 1",
    });

    // Um evento por item alterado, com a situação anterior registrada.
    expect(mocks.insertProductionEvent).toHaveBeenCalledTimes(2);
    expect(mocks.insertProductionEvent).toHaveBeenCalledWith(expect.anything(), {
      productionProcessId: "pp-1",
      userId: "user-1",
      eventType: "STATUS_CHANGE",
      oldStatus: "NAO_INICIADO",
      newStatus: "CONCLUIDO",
      oldQuantity: 1,
      newQuantity: 1,
      notes: "obs 1",
    });

    // Status agregado re-derivado dos itens atingidos.
    expect(mocks.getItemAggregate).toHaveBeenCalledTimes(2);
    expect(mocks.refreshOrderStatuses).toHaveBeenCalledTimes(2);
    expect(mocks.refreshOrderStatuses).toHaveBeenCalledWith(expect.anything(), "item-1", "CONCLUIDO");

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
    expect(mocks.updateProductionProcess).not.toHaveBeenCalled();
    expect(mocks.refreshOrderStatuses).not.toHaveBeenCalled();
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
