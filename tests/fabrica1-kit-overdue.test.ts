import { describe, expect, it } from "vitest";

import { KIT_PROCESS_CODE } from "@/lib/constants/processes";
import type { OrderScheduleIndex } from "@/lib/types/scheduling";
import type { ChildItemGroup, ChildItemGroupMember, ChildItemProcess } from "@/lib/types/order";
import {
  buildChildItemGroup,
  isChildItemKitOverdue,
  kitOverdueGroups,
  kitWindowForGroup,
  summarizeKitOverdue,
} from "@/lib/utils/child-item-groups";

const TODAY = "2026-10-20";

function schedule(windows: Record<string, string | null>): OrderScheduleIndex {
  return {
    windowsByOrder: Object.fromEntries(
      Object.entries(windows)
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(([orderId, start]) => [orderId, { KIT: { start, end: start } }]),
    ),
    expeditionByOrder: {},
  };
}

function process(status: ChildItemProcess["status"]): ChildItemProcess {
  return {
    id: "pp-kit",
    code: KIT_PROCESS_CODE,
    name: "KIT",
    displayOrder: 80,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
  };
}

function member(overrides: Partial<ChildItemGroupMember> = {}): ChildItemGroupMember {
  return {
    id: "m1",
    description: "SUPORTE",
    parentItem: "P-1",
    parentDescription: "GUARDA CORPO",
    parentDeliveryDate: null,
    parentProcessStatuses: { MP: "CONCLUIDO" },
    parentMpCompletedAt: null,
    parentMpReceipt: null,
    quantity: 4,
    unitWeightKg: 1.5,
    deliveryDate: "2026-10-16",
    seq: null,
    processes: [process("NAO_INICIADO")],
    materials: [],
    ...overrides,
  };
}

function group(
  orderId: string,
  overrides: Partial<ChildItemGroupMember> = {},
): ChildItemGroup {
  return buildChildItemGroup({
    order: { id: orderId, code: orderId, customerName: "ACME" },
    key: `child-${orderId}`,
    childItem: "CH-1",
    members: [member(overrides)],
  });
}

describe("Fábrica 1 KIT: datas do sequenciamento da OF", () => {
  it("usa a janela do KIT da OF, sem recalcular a partir da entrega do filho", () => {
    const item = group("o1", { deliveryDate: "2099-01-02" });
    const index = schedule({ o1: "2026-10-19" });

    expect(kitWindowForGroup(item, index)).toEqual({
      start: "2026-10-19",
      end: "2026-10-19",
    });
    expect(isChildItemKitOverdue(item, index, TODAY)).toBe(true);
  });

  it("não classifica como atrasado quando não existe janela no índice", () => {
    const item = group("o1", { processes: [process("NAO_INICIADO")] });
    expect(kitWindowForGroup(item, schedule({}))).toBeNull();
    expect(isChildItemKitOverdue(item, schedule({}), TODAY)).toBe(false);
  });

  it("ignora KIT concluído ou não aplicável", () => {
    const index = schedule({ o1: "2020-01-01" });
    expect(isChildItemKitOverdue(group("o1", { processes: [process("CONCLUIDO")] }), index, TODAY)).toBe(false);
    expect(
      isChildItemKitOverdue(group("o1", { processes: [process("NAO_APLICAVEL")] }), index, TODAY),
    ).toBe(false);
  });

  it("recorta e resume janelas por OF, compartilhadas entre grupos da mesma OF", () => {
    const index = schedule({ o1: "2020-01-01", o2: "2099-01-01" });
    const atraso = group("o1", { quantity: 4, unitWeightKg: 1.5 });
    const mesmoPedido = group("o1", { quantity: 2, unitWeightKg: 3 });
    const futuro = group("o2", { quantity: 10, unitWeightKg: 2 });

    expect(kitOverdueGroups([atraso, futuro, mesmoPedido], index, TODAY)).toEqual([atraso, mesmoPedido]);
    expect(summarizeKitOverdue([atraso, futuro, mesmoPedido], index, TODAY)).toEqual({
      records: 2,
      qty: 6,
      weight: 12,
    });
  });
});
