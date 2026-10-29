import { describe, expect, it } from "vitest";

import { KIT_PROCESS_CODE } from "@/lib/constants/processes";
import type { ChildItemGroup, ChildItemGroupMember, ChildItemProcess } from "@/lib/types/order";
import {
  buildChildItemGroup,
  isChildItemKitOverdue,
  kitOverdueGroups,
  kitWindowForGroup,
  summarizeKitOverdue,
} from "@/lib/utils/child-item-groups";

/**
 * REGRA DO KIT — card "Atrasados" da Fábrica 1: o grupo conta quando a data da
 * coluna KIT (início previsto da janela) é anterior à data de referência.
 *
 * 2026-10-20 é terça-feira; as datas dos fixtures caem em dias conhecidos
 * (10-16 sexta, 10-23 sexta, 10-24 sábado, 11-20 sexta).
 */
const TODAY = "2026-10-20";

/** Mesmo catálogo com que a tabela calcula as janelas (código + ordem + duração). */
const CATALOG = [
  { code: "LASER", displayOrder: 10, durationDays: 1 },
  { code: "SERRA", displayOrder: 30, durationDays: 1 },
  { code: KIT_PROCESS_CODE, displayOrder: 80, durationDays: 2 },
  { code: "PRE_MTG", displayOrder: 90, durationDays: 1 },
  { code: "EXP", displayOrder: 130, durationDays: 1 },
];

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

/** Linha agrupada (grupo de 1 membro) com os campos que a regra lê. */
function group(overrides: Partial<ChildItemGroupMember> = {}): ChildItemGroup {
  return buildChildItemGroup({
    order: { id: "o1", code: "OF-107482", customerName: "ACME" },
    key: "CH-1",
    childItem: "CH-1",
    members: [member(overrides)],
  });
}

describe("janela do KIT na linha agrupada", () => {
  it("reproduz a janela da célula KIT (dias úteis de trás para frente da entrega)", () => {
    const window = kitWindowForGroup(group(), CATALOG);
    // Entrega sexta 16/10: PRÉ-MTG e EXP ocupam 1 dia cada antes dela e o
    // KIT tem 2 dias úteis — começa na segunda 12/10 e termina 13/10.
    expect(window).toEqual({ start: "2026-10-12", end: "2026-10-13" });
  });

  it("sem data de entrega não há janela", () => {
    expect(kitWindowForGroup(group({ deliveryDate: null }), CATALOG)).toBeNull();
  });
});

describe("isChildItemKitOverdue — card Atrasados da Fábrica 1", () => {
  it("conta quando o início do KIT é anterior a hoje", () => {
    expect(isChildItemKitOverdue(group(), CATALOG, TODAY)).toBe(true);
  });

  it("conta quando o início do KIT é a véspera", () => {
    // Entrega 23/10 (sexta) → início do KIT 19/10 (segunda).
    const item = group({ deliveryDate: "2026-10-23" });
    expect(kitWindowForGroup(item, CATALOG)?.start).toBe("2026-10-19");
    expect(isChildItemKitOverdue(item, CATALOG, TODAY)).toBe(true);
  });

  it("NÃO conta quando o início do KIT é exatamente hoje", () => {
    // Entrega 24/10 (sábado) → o fim de semana desloca a janela e o KIT
    // começa exatamente na data de referência.
    const item = group({ deliveryDate: "2026-10-24" });
    expect(kitWindowForGroup(item, CATALOG)?.start).toBe(TODAY);
    expect(isChildItemKitOverdue(item, CATALOG, TODAY)).toBe(false);
  });

  it("NÃO conta quando o início do KIT ainda está no futuro", () => {
    const item = group({ deliveryDate: "2026-11-20" });
    expect(kitWindowForGroup(item, CATALOG)?.start).toBe("2026-11-16");
    expect(isChildItemKitOverdue(item, CATALOG, TODAY)).toBe(false);
  });

  it("NÃO conta KIT já CONCLUÍDO mesmo com o início vencido", () => {
    const item = group({ processes: [process(KIT_PROCESS_CODE, "CONCLUIDO")] });
    expect(isChildItemKitOverdue(item, CATALOG, TODAY)).toBe(false);
  });

  it("NÃO conta KIT não aplicável", () => {
    const item = group({ processes: [process(KIT_PROCESS_CODE, "NAO_APLICAVEL")] });
    expect(isChildItemKitOverdue(item, CATALOG, TODAY)).toBe(false);
  });

  it("NÃO conta grupo sem o processo KIT", () => {
    const item = group({ processes: [process("LASER", "NAO_INICIADO")] });
    expect(isChildItemKitOverdue(item, CATALOG, TODAY)).toBe(false);
  });

  it("NÃO conta grupo sem data de entrega (sem janela para comparar)", () => {
    expect(isChildItemKitOverdue(group({ deliveryDate: null }), CATALOG, TODAY)).toBe(false);
  });
});

describe("summarizeKitOverdue — os três números do card", () => {
  it("soma registros, quantidade e peso só dos grupos atrasados", () => {
    const atrasado = group({ quantity: 4, unitWeightKg: 1.5 }); // 4 × 1.5 = 6
    const futuro = group({ deliveryDate: "2026-11-20", quantity: 10, unitWeightKg: 2 });
    const concluido = group({ processes: [process(KIT_PROCESS_CODE, "CONCLUIDO")], quantity: 5 });

    expect(summarizeKitOverdue([atrasado, futuro, concluido], CATALOG, TODAY)).toEqual({
      records: 1,
      qty: 4,
      weight: 6,
    });
  });

  it("grupo sem peso entra como 0 na soma (mesma convenção dos demais cards)", () => {
    const semPeso = group({ unitWeightKg: null }); // weightTotal null
    const comPeso = group({ deliveryDate: "2026-10-16", quantity: 2, unitWeightKg: 3 });

    expect(summarizeKitOverdue([semPeso, comPeso], CATALOG, TODAY)).toEqual({
      records: 2,
      qty: 6, // 4 + 2
      weight: 6, // só o segundo tem peso
    });
  });

  it("lista vazia devolve zeros", () => {
    expect(summarizeKitOverdue([], CATALOG, TODAY)).toEqual({ records: 0, qty: 0, weight: 0 });
  });
});

describe("kitOverdueGroups — recorte aplicado ao clicar no card", () => {
  it("mantém só os grupos com o KIT vencido, na ordem original", () => {
    const futuro = group({ deliveryDate: "2026-11-20" }); // KIT ainda no prazo
    const atrasado = group({ quantity: 4 });
    const concluido = group({ processes: [process(KIT_PROCESS_CODE, "CONCLUIDO")] });

    expect(kitOverdueGroups([futuro, atrasado, concluido], CATALOG, TODAY)).toEqual([atrasado]);
  });

  it("a lista filtrada bate com os números do card", () => {
    const items = [group({ quantity: 4, unitWeightKg: 1.5 }), group({ deliveryDate: "2026-11-20" })];
    const groups = kitOverdueGroups(items, CATALOG, TODAY);

    expect(groups).toHaveLength(summarizeKitOverdue(items, CATALOG, TODAY).records);
  });
});
