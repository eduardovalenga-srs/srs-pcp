import { describe, expect, it } from "vitest";

import type { ChildItemGroupMember, ChildItemProcess, OrderItemMaterial } from "@/lib/types/order";
import {
  aggregateGroupProcesses,
  aggregateGroupStatus,
  buildChildItemGroup,
  mergeGroupMaterials,
} from "@/lib/utils/child-item-groups";

/** Membro de um grupo — só os campos que a agregação lê. */
function member(overrides: Partial<ChildItemGroupMember> = {}): ChildItemGroupMember {
  return {
    id: "m1",
    description: "SUPORTE 90",
    parentItem: "P-1",
    parentDescription: "GUARDA CORPO",
    parentDeliveryDate: "2026-10-20",
    parentProcessStatuses: { MP: "CONCLUIDO" },
    parentMpCompletedAt: "2026-10-12T10:00:00+00:00",
    quantity: 2,
    unitWeightKg: 1.5,
    deliveryDate: "2026-10-18",
    seq: null,
    processes: [],
    materials: [],
    ...overrides,
  };
}

function process(
  code: string,
  status: ChildItemProcess["status"],
  extra: Partial<ChildItemProcess> = {},
): ChildItemProcess {
  return {
    id: `pp-${code}`,
    code,
    name: code,
    displayOrder: 10,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    ...extra,
  };
}

function material(overrides: Partial<OrderItemMaterial> = {}): OrderItemMaterial {
  return {
    id: "mat-1",
    description: "Chapa 3mm",
    quantity: 2,
    unit: "M2",
    notes: null,
    ...overrides,
  };
}

describe("situação agregada do grupo (033)", () => {
  it("CONCLUIDO só quando todos os aplicáveis concluíram", () => {
    expect(aggregateGroupStatus(["CONCLUIDO", "CONCLUIDO"])).toBe("CONCLUIDO");
    expect(aggregateGroupStatus(["CONCLUIDO", "NAO_INICIADO"])).toBe("NAO_INICIADO");
    expect(aggregateGroupStatus(["NAO_INICIADO", "NAO_INICIADO"])).toBe("NAO_INICIADO");
  });

  it("NAO_APLICAVEL só quando nenhum membro se aplica", () => {
    expect(aggregateGroupStatus(["NAO_APLICAVEL", "NAO_APLICAVEL"])).toBe("NAO_APLICAVEL");
    expect(aggregateGroupStatus([])).toBe("NAO_APLICAVEL");
    // Um aplicável já concluído conta como concluído mesmo com um não aplicável.
    expect(aggregateGroupStatus(["NAO_APLICAVEL", "CONCLUIDO"])).toBe("CONCLUIDO");
    expect(aggregateGroupStatus(["NAO_APLICAVEL", "NAO_INICIADO"])).toBe("NAO_INICIADO");
  });
});

describe("processos agregados do grupo", () => {
  it("soma quantidades só dos membros aplicáveis e agrega a situação", () => {
    const group = aggregateGroupProcesses([
      member({
        processes: [
          process("LASER", "CONCLUIDO", { quantityPlanned: 2, quantityCompleted: 2 }),
        ],
      }),
      member({
        processes: [
          process("LASER", "NAO_INICIADO", { quantityPlanned: 3, quantityCompleted: 1 }),
        ],
      }),
      member({
        processes: [process("LASER", "NAO_APLICAVEL", { quantityPlanned: 99 })],
      }),
    ]);

    expect(group).toHaveLength(1);
    expect(group[0]).toMatchObject({
      code: "LASER",
      status: "NAO_INICIADO",
      quantityPlanned: 5, // 2 + 3 (o NAO_APLICAVEL não infla)
      quantityCompleted: 3, // 2 + 1
    });
  });

  it("preserva a ordem do catálogo e pega a primeira observação aplicável", () => {
    const group = aggregateGroupProcesses([
      member({
        processes: [
          process("EXP", "NAO_INICIADO", { displayOrder: 120 }),
          process("LASER", "CONCLUIDO", { displayOrder: 10, notes: "ok" }),
        ],
      }),
      member({
        processes: [process("LASER", "CONCLUIDO", { displayOrder: 10, notes: "outra" })],
      }),
    ]);

    expect(group.map((entry) => entry.code)).toEqual(["LASER", "EXP"]);
    expect(group[0]?.status).toBe("CONCLUIDO");
    expect(group[0]?.notes).toBe("ok");
  });

  it("membro sem o processo não muda o agregado (status vazio => NAO_APLICAVEL)", () => {
    const group = aggregateGroupProcesses([
      member({ processes: [] }),
      member({ processes: [process("SERRA", "NAO_APLICAVEL")] }),
    ]);
    expect(group[0]?.status).toBe("NAO_APLICAVEL");
  });
});

describe("materiais mesclados do grupo", () => {
  it("mescla por descrição (sem caixa/espaços) + unidade somando quantidade", () => {
    const merged = mergeGroupMaterials([
      member({ materials: [material({ id: "a", description: "Chapa 3mm", quantity: 2 })] }),
      member({
        materials: [material({ id: "b", description: "  chapa 3MM ", quantity: 3, notes: "obs" })],
      }),
      // Unidade diferente NÃO mescla.
      member({ materials: [material({ id: "c", description: "Chapa 3mm", quantity: 1, unit: "KG" })] }),
    ]);

    expect(merged).toHaveLength(2);
    const chapa = merged.find((entry) => entry.unit === "M2");
    expect(chapa).toMatchObject({ id: "a", quantity: 5, notes: "obs" });
    expect(merged.find((entry) => entry.unit === "KG")?.quantity).toBe(1);
  });

  it("ordena por descrição e mantém a primeira observação não vazia", () => {
    const merged = mergeGroupMaterials([
      member({ materials: [material({ description: "Zinc", quantity: 1 })] }),
      member({
        materials: [material({ description: "Aço", quantity: 1, notes: "primeira" })],
      }),
    ]);
    expect(merged.map((entry) => entry.description)).toEqual(["Aço", "Zinc"]);
    expect(merged[0]?.notes).toBe("primeira");
  });
});

describe("buildChildItemGroup — linha agrupada da Fábrica 1", () => {
  const order = { id: "o1", code: "OF-107482", customerName: "ACME" };

  it("soma quantidade e peso, com peso unitário só quando todos coincidem", () => {
    const iguais = buildChildItemGroup({
      order,
      key: "CH-1",
      childItem: "CH-1",
      members: [member({ quantity: 2, unitWeightKg: 1.5 }), member({ id: "m2", quantity: 3, unitWeightKg: 1.5 })],
    });
    expect(iguais).toMatchObject({
      id: "g:o1:CH-1",
      memberCount: 2,
      memberIds: ["m1", "m2"],
      quantity: 5,
      unitWeightKg: 1.5,
      weightTotal: 7.5, // 2×1.5 + 3×1.5
    });

    const divergentes = buildChildItemGroup({
      order,
      key: "CH-2",
      childItem: "CH-2",
      members: [member({ quantity: 2, unitWeightKg: 1.5 }), member({ id: "m2", quantity: 3, unitWeightKg: 2 })],
    });
    expect(divergentes.unitWeightKg).toBeNull(); // exibe "—" na coluna
    expect(divergentes.weightTotal).toBe(9); // mas o total continua somando

    const semPeso = buildChildItemGroup({
      order,
      key: "CH-3",
      childItem: "CH-3",
      members: [member({ unitWeightKg: null })],
    });
    expect(semPeso.weightTotal).toBeNull();
  });

  it("entrega do grupo é a MENOR entre os membros (ignora nulos)", () => {
    const group = buildChildItemGroup({
      order,
      key: "CH-1",
      childItem: "CH-1",
      members: [
        member({ deliveryDate: "2026-10-25" }),
        member({ id: "m2", deliveryDate: "2026-10-18" }),
        member({ id: "m3", deliveryDate: null }),
      ],
    });
    expect(group.deliveryDate).toBe("2026-10-18");
  });

  it("seq do grupo é o MENOR entre os membros; sem nenhum numerado fica null (036)", () => {
    const numerado = buildChildItemGroup({
      order,
      key: "CH-1",
      childItem: "CH-1",
      members: [
        member({ seq: 7 }),
        member({ id: "m2", seq: 3 }),
        member({ id: "m3", seq: null }),
      ],
    });
    expect(numerado.seq).toBe(3);

    const semSeq = buildChildItemGroup({
      order,
      key: "CH-2",
      childItem: "CH-2",
      members: [member({ seq: null }), member({ id: "m2", seq: null })],
    });
    expect(semSeq.seq).toBeNull();
  });

  it("agrega a coluna MP herdada entre os PAIS distintos", () => {
    const group = buildChildItemGroup({
      order,
      key: "CH-1",
      childItem: "CH-1",
      members: [
        // Dois membros do MESMO pai (dedupe) + um de outro pai.
        member({
          parentItem: "P-1",
          parentProcessStatuses: { MP: "CONCLUIDO" },
          parentMpCompletedAt: "2026-10-12T10:00:00+00:00",
          parentDeliveryDate: "2026-10-20",
        }),
        member({
          id: "m2",
          parentItem: "P-1",
          parentProcessStatuses: { MP: "CONCLUIDO" },
          parentMpCompletedAt: "2026-10-12T10:00:00+00:00",
          parentDeliveryDate: "2026-10-20",
        }),
        member({
          id: "m3",
          parentItem: "P-2",
          parentProcessStatuses: { MP: "NAO_INICIADO" },
          parentMpCompletedAt: null,
          parentDeliveryDate: "2026-10-15",
        }),
      ],
    });

    expect(group.parentItems).toEqual(["P-1", "P-2"]); // dedupe por pai
    expect(group.parentItem).toBe("P-1"); // badge do primeiro membro
    // Um pai ainda não recebeu => agregado pendente (célula não mostra data).
    expect(group.parentProcessStatuses.MP).toBe("NAO_INICIADO");
    expect(group.parentDeliveryDate).toBe("2026-10-15"); // menor entrega dos pais
    expect(group.parentMpCompletedAt).toBe("2026-10-12T10:00:00+00:00");
  });

  it("mostra o recebimento da MP quando TODOS os pais aplicáveis concluíram", () => {
    const group = buildChildItemGroup({
      order,
      key: "CH-1",
      childItem: "CH-1",
      members: [
        member({
          parentItem: "P-1",
          parentProcessStatuses: { MP: "CONCLUIDO" },
          parentMpCompletedAt: "2026-10-12T10:00:00+00:00",
        }),
        member({
          id: "m2",
          parentItem: "P-2",
          parentProcessStatuses: { MP: "CONCLUIDO" },
          parentMpCompletedAt: "2026-10-14T08:00:00+00:00",
        }),
      ],
    });
    expect(group.parentProcessStatuses.MP).toBe("CONCLUIDO");
    // Data efetiva mais recente entre os pais.
    expect(group.parentMpCompletedAt).toBe("2026-10-14T08:00:00+00:00");
  });

  it("descrição vem do primeiro membro e materiais saem mesclados", () => {
    const group = buildChildItemGroup({
      order,
      key: "CH-1",
      childItem: "CH-1",
      members: [
        member({
          description: "SUPORTE 90",
          materials: [material({ description: "Chapa 3mm", quantity: 2 })],
        }),
        member({
          id: "m2",
          description: "SUPORTE 90",
          materials: [material({ id: "b", description: "Chapa 3mm", quantity: 3 })],
        }),
      ],
    });
    expect(group.description).toBe("SUPORTE 90");
    expect(group.orderCode).toBe("OF-107482");
    expect(group.materials).toHaveLength(1);
    expect(group.materials[0]?.quantity).toBe(5);
  });
});
