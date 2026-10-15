import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({ id: "user-1", role: "GESTOR" })),
  createClient: vi.fn(async () => ({ name: "client" })),
  updateOrderDeliveryDate: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
// O service de pedidos (importado pela action) também usa estes módulos.
vi.mock("@/lib/repositories/orders.repository", () => ({
  updateOrderDeliveryDate: mocks.updateOrderDeliveryDate,
}));
vi.mock("@/lib/repositories/order-items.repository", () => ({
  getOrderItemWithProcesses: vi.fn(async () => null),
  updateItemDeliveryDate: vi.fn(async () => {}),
}));

import { updateOrderDeliveryDateAction } from "@/lib/actions/orders.actions";

describe("updateOrderDeliveryDateAction (025 — entrega do PEDIDO)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ id: "user-1", role: "GESTOR" });
    mocks.createClient.mockResolvedValue({ name: "client" });
    mocks.updateOrderDeliveryDate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exige a capacidade orders.edit", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("Permissão negada."));

    const result = await updateOrderDeliveryDateAction("of-1", "2026-10-20");

    expect(result.success).toBe(false);
    expect(result.message).toContain("Permissão");
    expect(mocks.updateOrderDeliveryDate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("grava a nova entrega do pedido e invalida as telas afetadas", async () => {
    const result = await updateOrderDeliveryDateAction("of-1", "2026-10-20");

    expect(result).toMatchObject({ success: true, deliveryDate: "2026-10-20" });
    expect(mocks.updateOrderDeliveryDate).toHaveBeenCalledWith(
      expect.anything(),
      "of-1",
      "2026-10-20",
    );

    // A gestão de entregas consolidada lê a data do PEDIDO; a Fábrica 2
    // (itens sem override) e o detalhe/RFQ do pedido recalculam janelas.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/gestao-entregas");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/fabrica-2");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/(dashboard)/pedidos/[id]", "page");
  });

  it("valor vazio limpa a entrega (null)", async () => {
    const result = await updateOrderDeliveryDateAction("of-1", "");

    expect(result).toMatchObject({ success: true, deliveryDate: null });
    expect(mocks.updateOrderDeliveryDate).toHaveBeenCalledWith(
      expect.anything(),
      "of-1",
      null,
    );
  });

  it("rejeita formatos fora de AAAA-MM-DD", async () => {
    const result = await updateOrderDeliveryDateAction("of-1", "10/10/2026");

    expect(result.success).toBe(false);
    expect(result.deliveryDate).toBeNull();
    expect(mocks.updateOrderDeliveryDate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejeita data impossível (31 de fevereiro)", async () => {
    const result = await updateOrderDeliveryDateAction("of-1", "2026-02-31");

    expect(result.success).toBe(false);
    expect(mocks.updateOrderDeliveryDate).not.toHaveBeenCalled();
  });

  it("erro do banco vira mensagem amigável", async () => {
    mocks.updateOrderDeliveryDate.mockRejectedValue(
      new Error("Pedido não encontrado ou sem permissão para editar a entrega."),
    );

    const result = await updateOrderDeliveryDateAction("of-1", "2026-10-20");

    expect(result.success).toBe(false);
    expect(result.message).toContain("sem permissão");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
