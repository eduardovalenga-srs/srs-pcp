import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({ id: "user-1", role: "GESTOR" })),
  createClient: vi.fn(async () => ({ name: "client" })),
  updateItemDeliveryDate: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
// O service de pedidos (importado pela action) também usa este módulo.
vi.mock("@/lib/repositories/order-items.repository", () => ({
  getOrderItemWithProcesses: vi.fn(async () => null),
  updateItemDeliveryDate: mocks.updateItemDeliveryDate,
}));

import { updateItemDeliveryDateAction } from "@/lib/actions/orders.actions";

describe("updateItemDeliveryDateAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exige a capacidade de edição de pedido (orders.edit)", async () => {
    await updateItemDeliveryDateAction("item-1", "2026-10-10");

    expect(mocks.requireCapability).toHaveBeenCalledWith("orders.edit");
  });

  it("grava a nova data e recalcula as rotas da gestão de entregas", async () => {
    const result = await updateItemDeliveryDateAction("item-1", "2026-10-10");

    expect(result.success).toBe(true);
    expect(result.deliveryDate).toBe("2026-10-10");
    // As previsões derivam da data na leitura: refresh das rotas exibidas.
    expect(mocks.updateItemDeliveryDate).toHaveBeenCalledWith(
      expect.any(Object),
      "item-1",
      "2026-10-10",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/gestao-entregas");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/fabrica-2");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/(dashboard)/pedidos/[id]", "page");
  });

  it("aceita vazio como limpar a entrega (previsões ficam sem data)", async () => {
    const result = await updateItemDeliveryDateAction("item-1", "");

    expect(result.success).toBe(true);
    expect(result.deliveryDate).toBeNull();
    expect(mocks.updateItemDeliveryDate).toHaveBeenCalledWith(expect.any(Object), "item-1", null);
  });

  it("aceita nulo como limpar a entrega", async () => {
    const result = await updateItemDeliveryDateAction("item-1", null);

    expect(result.success).toBe(true);
    expect(result.deliveryDate).toBeNull();
    expect(mocks.updateItemDeliveryDate).toHaveBeenCalledWith(expect.any(Object), "item-1", null);
  });

  it("recusa data fora do formato AAAA-MM-DD", async () => {
    const result = await updateItemDeliveryDateAction("item-1", "10/10/2026");

    expect(result.success).toBe(false);
    expect(result.message).toBeTruthy();
    expect(mocks.updateItemDeliveryDate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("recusa data de calendário inválida (dia inexistente)", async () => {
    const result = await updateItemDeliveryDateAction("item-1", "2026-02-31");

    expect(result.success).toBe(false);
    expect(mocks.updateItemDeliveryDate).not.toHaveBeenCalled();
  });

  it("sem permissão não grava nem recalcula", async () => {
    mocks.requireCapability.mockRejectedValueOnce(new Error("Acesso negado."));

    const result = await updateItemDeliveryDateAction("item-1", "2026-10-10");

    expect(result.success).toBe(false);
    expect(mocks.updateItemDeliveryDate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("propaga erro do repositório (item inexistente) como falha", async () => {
    mocks.updateItemDeliveryDate.mockRejectedValueOnce(
      new Error("Item não encontrado ou sem permissão para editar a entrega."),
    );

    const result = await updateItemDeliveryDateAction("item-inexistente", "2026-10-10");

    expect(result.success).toBe(false);
    expect(result.message).toContain("não encontrado");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
