import { beforeEach, describe, expect, it, vi } from "vitest";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodError } from "zod";

import {
  decimalInput,
  firstZodMessage,
  nullableDate,
  nullableText,
  optionalDecimalInput,
} from "@/lib/validators/common";
import { orderWithItemsSchema, type OrderWithItemsInput, type OrderWithItemsOutput } from "@/lib/validators/order-item.schema";
import type { ProcessDefinition } from "@/lib/types/production";

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  // Linha de processo já gravada do item (edição) — o serviço lê
  // code/status/quantidades/notas para montar o plano.
  interface ExistingProcess {
    code: string;
    status: string;
    quantityPlanned?: number | null;
    quantityCompleted?: number | null;
    notes?: string | null;
  }

  return {
    catalog: [
      { id: "1", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
      { id: "2", code: "SOLDA", name: "SOLDA", displayOrder: 90, active: true, location: null, durationDays: 1 },
      { id: "3", code: "EXP", name: "EXP", displayOrder: 120, active: true, location: null, durationDays: 1 },
    ] as ProcessDefinition[],
    applyPlan: vi.fn<(client: unknown, plan: unknown) => Promise<void>>(async () => {}),
    findItemsByOrderCodes: vi.fn(async (): Promise<Map<string, unknown>> => new Map()),
    // Pós-save: devolve o id do pedido para o redirect à tela de detalhes.
    findOrdersByCodes: vi.fn(
      async (_client: unknown, codes: string[]): Promise<Map<string, { id: string }>> =>
        new Map(codes.map((code) => [code, { id: "order-id-123" }])),
    ),
    getOrderItemWithProcesses: vi.fn(
      async (): Promise<{ id: string; processes: ExistingProcess[] } | null> => null,
    ),
  };
});

vi.mock("@/lib/repositories/production.repository", () => ({
  getActiveProcesses: vi.fn(async () => mocks.catalog),
}));

vi.mock("@/lib/repositories/orders.repository", () => ({
  // Mesma fórmula do repositório real (chave lógica de duplicidade).
  buildItemKey: (orderCode: string, parentItem: string | null, description: string): string => {
    const parent = parentItem?.trim();
    if (parent) return `${orderCode.trim().toUpperCase()}::${parent.toUpperCase()}`;
    return `${orderCode.trim().toUpperCase()}::#${description.trim().toUpperCase()}`;
  },
  findItemsByOrderCodes: mocks.findItemsByOrderCodes,
  findOrdersByCodes: mocks.findOrdersByCodes,
  deleteOrder: vi.fn(),
  getOrderDetails: vi.fn(),
  listOrders: vi.fn(),
}));

vi.mock("@/lib/repositories/order-items.repository", () => ({
  getOrderItemWithProcesses: mocks.getOrderItemWithProcesses,
}));

vi.mock("@/lib/repositories/import.repository", () => ({
  applyPlan: mocks.applyPlan,
}));

import { saveOrder } from "@/lib/services/orders.service";
import type { SupabaseServer } from "@/lib/supabase/types";

// ---------------------------------------------------------------- helpers

type Parsed<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: ZodError };

function expectOk<T>(result: Parsed<T>): T {
  if (!result.success) throw new Error(`esperava sucesso, veio: ${firstZodMessage(result.error)}`);
  return result.data;
}

function expectError(result: Parsed<unknown>): ZodError {
  if (result.success) throw new Error("esperava falha de validação, mas os dados são válidos");
  return result.error;
}

// ---------------------------------------------------------------- payloads

type ItemInput = OrderWithItemsInput["items"][number];

/**
 * Valores crus do formulário — exatamente o que `buildDefaultValues` do
 * OrderForm produz: tudo em texto (o `<input>` devolve string).
 */
const RAW_FORM: OrderWithItemsInput = {
  type: "OF",
  code: "of-1234",
  customerName: "Metalúrgica Alfa",
  description: "",
  orderDate: "2026-10-01",
  deliveryDate: "2026-10-15",
  items: [
    {
      family: "ESTRUTURA",
      parentItem: "",
      description: "Viga 100x50",
      quantity: "5",
      unitWeightKg: "",
      deliveryDate: "",
      op: "",
      processCodes: ["LASER", "SOLDA"],
    },
  ],
};

/** Payload já transformado (é o que o zodResolver envia para a Server Action). */
const ITEM: ItemInput = {
  family: "ESTRUTURA",
  parentItem: "",
  description: "Viga 100x50",
  quantity: 5, // number: era exatamente o que derrubava o salvamento
  unitWeightKg: 12.5,
  deliveryDate: "",
  op: "",
  processCodes: ["LASER", "SOLDA"],
};

const ORDER: OrderWithItemsInput = {
  ...RAW_FORM,
  items: [ITEM],
};

function payload(overrides: Partial<ItemInput>): OrderWithItemsInput {
  return { ...ORDER, items: [{ ...ITEM, ...overrides }] };
}

interface PlanOperation {
  action: string;
  order: { code: string; type: string; customerName: string | null; status: string };
  item: {
    family: string | null;
    parentItem: string | null;
    description: string;
    quantity: number;
    unitWeightKg: number | null;
    deliveryDate: string | null;
    status: string;
    op: string | null;
    processes: {
      code: string;
      status: string;
      quantityPlanned: number | null;
      quantityCompleted: number | null;
      notes: string | null;
    }[];
  };
}

function readPlan(): { operations: PlanOperation[] } {
  const call = mocks.applyPlan.mock.calls[0];
  expect(call, "saveOrder deveria ter chamado applyPlan").toBeDefined();
  return call[1] as { operations: PlanOperation[] };
}

const client = {} as unknown as SupabaseServer;

beforeEach(() => {
  mocks.applyPlan.mockClear();
  mocks.findItemsByOrderCodes.mockClear();
  mocks.findOrdersByCodes.mockClear();
  mocks.getOrderItemWithProcesses.mockClear();
});

// ---------------------------------------------------------------- testes

describe("decimalInput / optionalDecimalInput", () => {
  const quantity = decimalInput("Quantidade", { min: 0.001 });
  const weight = optionalDecimalInput("Peso unitário", { min: 0 });

  it("aceita número já convertido (payload do formulário)", () => {
    expect(expectOk(quantity.safeParse(5))).toBe(5);
    expect(expectOk(weight.safeParse(12.5))).toBe(12.5);
  });

  it("aceita texto com vírgula decimal (planilha)", () => {
    expect(expectOk(quantity.safeParse("80,5"))).toBe(80.5);
    expect(expectOk(weight.safeParse("12,5"))).toBe(12.5);
    expect(expectOk(quantity.safeParse(" 10 "))).toBe(10);
  });

  it("converte vazio em null no campo opcional", () => {
    expect(expectOk(weight.safeParse(""))).toBeNull();
    expect(expectOk(weight.safeParse(null))).toBeNull();
    expect(expectOk(weight.safeParse(undefined))).toBeNull();
  });

  it("mantém as mensagens próprias em pt-BR", () => {
    expect(firstZodMessage(expectError(quantity.safeParse("")))).toBe("Quantidade é obrigatório");
    expect(firstZodMessage(expectError(quantity.safeParse(0)))).toBe(
      "Quantidade deve ser maior ou igual a 0.001",
    );
    expect(firstZodMessage(expectError(weight.safeParse(-1)))).toBe(
      "Peso unitário deve ser maior ou igual a 0",
    );
    expect(firstZodMessage(expectError(quantity.safeParse("abc")))).toBe("Quantidade inválido");
  });
});

describe("nullableText / nullableDate", () => {
  const text = nullableText(200);

  it("aceita texto, vazio, null e ausente — tudo vira null", () => {
    expect(expectOk(text.safeParse("Alfa"))).toBe("Alfa");
    expect(expectOk(text.safeParse(""))).toBeNull();
    expect(expectOk(text.safeParse(null))).toBeNull();
    expect(expectOk(text.safeParse(undefined))).toBeNull();
  });

  it("aplica o limite com mensagem própria", () => {
    expect(firstZodMessage(expectError(text.safeParse("x".repeat(201))))).toBe(
      "Máximo de 200 caracteres",
    );
  });

  it("aceita data válida e devolve null para vazio/null/ausente", () => {
    expect(expectOk(nullableDate.safeParse("2026-10-15"))).toBe("2026-10-15");
    expect(expectOk(nullableDate.safeParse(""))).toBeNull();
    expect(expectOk(nullableDate.safeParse(null))).toBeNull();
    expect(expectOk(nullableDate.safeParse(undefined))).toBeNull();
    expect(firstZodMessage(expectError(nullableDate.safeParse("15/10/2026")))).toBe(
      "Use o formato DD/MM/AAAA",
    );
  });
});

describe("firstZodMessage", () => {
  it("traduz a mensagem padrão do zod (era ela que aparecia no toast)", () => {
    const error = expectError(orderWithItemsSchema.safeParse({ ...ORDER, code: 123 }));
    const message = firstZodMessage(error);

    expect(message).toBe("Número do pedido: valor inválido (esperado texto)");
    expect(message).not.toContain("Invalid input");
  });

  it("aponta o campo dentro do array de itens", () => {
    const error = expectError(
      orderWithItemsSchema.safeParse(payload({ description: 123 as unknown as string })),
    );

    expect(firstZodMessage(error)).toBe("Item 1 — Descrição: valor inválido (esperado texto)");
  });

  it("preserva as mensagens próprias de enum e de itens", () => {
    expect(firstZodMessage(expectError(orderWithItemsSchema.safeParse({ ...ORDER, type: "XX" })))).toBe(
      "Selecione o tipo (OF/OS)",
    );
    expect(firstZodMessage(expectError(orderWithItemsSchema.safeParse({ ...ORDER, items: [] })))).toBe(
      "Adicione ao menos um item",
    );
    expect(
      firstZodMessage(expectError(orderWithItemsSchema.safeParse(payload({ processCodes: [] })))),
    ).toBe("Selecione ao menos um processo");
  });
});

describe("orderWithItemsSchema", () => {
  it("aceita quantidade e peso unitário como number", () => {
    const data = expectOk<OrderWithItemsOutput>(orderWithItemsSchema.safeParse(ORDER));

    expect(data.code).toBe("OF-1234"); // normalizado para maiúsculas
    expect(data.items[0].quantity).toBe(5);
    expect(data.items[0].unitWeightKg).toBe(12.5);
    expect(data.customerName).toBe("Metalúrgica Alfa");
  });

  it("aceita os mesmos campos como texto (caminho do Excel)", () => {
    const data = expectOk<OrderWithItemsOutput>(
      orderWithItemsSchema.safeParse(payload({ quantity: "80,5", unitWeightKg: "12,5" })),
    );

    expect(data.items[0].quantity).toBe(80.5);
    expect(data.items[0].unitWeightKg).toBe(12.5);
  });

  it("recusa item sem quantidade com mensagem em pt-BR", () => {
    const error = expectError(orderWithItemsSchema.safeParse(payload({ quantity: "" })));

    expect(firstZodMessage(error)).toBe("Quantidade é obrigatório");
  });

  it("aceita o payload com campos vazios virando null (edição/re-salvamento)", () => {
    const data = expectOk<OrderWithItemsOutput>(
      orderWithItemsSchema.safeParse({
        ...ORDER,
        description: null,
        orderDate: null,
        deliveryDate: null,
        items: [{ ...ITEM, family: null, parentItem: null, deliveryDate: null, unitWeightKg: null }],
      }),
    );

    expect(data.description).toBeNull();
    expect(data.items[0].family).toBeNull();
    expect(data.items[0].parentItem).toBeNull();
    expect(data.items[0].unitWeightKg).toBeNull();
  });
});

describe("fluxo real do formulário (zodResolver -> saveOrder)", () => {
  it("valida os valores crus e grava o payload transformado", async () => {
    // 1) O formulário valida como texto — é assim que o OrderForm monta tudo.
    const resolver = zodResolver(orderWithItemsSchema);
    // O react-hook-form sempre envia as 3 opções (getResolverOptions).
    const validated = await resolver(RAW_FORM, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(validated.errors).toEqual({});

    // 2) O zodResolver entrega o OUTPUT: quantity vira number e campos vazios
    //    viram null. Antes da correção, o safeParse do servidor rejeitava isto
    //    com "Invalid input: expected string, received number".
    //    (o tipo do resolver é `values: output | {}` — o guard acima prova que
    //    deu certo em tempo de execução)
    const values = validated.values as OrderWithItemsOutput;
    expect(values.items[0].quantity).toBe(5);
    expect(values.items[0].unitWeightKg).toBeNull();
    expect(values.items[0].op).toBeNull(); // OP vazia vira null
    expect(values.description).toBeNull();

    // 3) A Server Action revalida e grava em uma única transação (apply_import).
    const result = await saveOrder(client, values);

    expect(result.code).toBe("OF-1234");
    expect(mocks.applyPlan).toHaveBeenCalledTimes(1);

    const plan = readPlan();
    expect(plan.operations).toHaveLength(1);

    const [operation] = plan.operations;
    expect(operation.action).toBe("CREATE");
    expect(operation.order).toMatchObject({
      code: "OF-1234",
      type: "OF",
      customerName: "Metalúrgica Alfa",
      status: "PLANEJADO",
    });
    expect(operation.item).toMatchObject({
      family: "ESTRUTURA",
      parentItem: null, // "" do formulário vira null na saída do resolver
      description: "Viga 100x50",
      quantity: 5,
      unitWeightKg: null,
      // 022: item sem entrega própria grava a do pedido — é o que faz a
      // janela prevista existir também no pedido manual.
      deliveryDate: "2026-10-15",
      status: "PLANEJADO", // derivado: sem OP e processos não concluídos
      op: null,
    });
    // O plano cobre o catálogo inteiro (022): os selecionados nascem
    // NAO_INICIADO e o desmarcado (EXP) entra como NAO_APLICAVEL — era
    // essa linha que faltava e fazia o processo voltar marcado na abertura.
    expect(operation.item.processes.map((process) => process.code)).toEqual(["LASER", "SOLDA", "EXP"]);
    expect(operation.item.processes[0]).toMatchObject({
      status: "NAO_INICIADO",
      quantityPlanned: null,
      quantityCompleted: null,
    });
    expect(operation.item.processes[2]).toMatchObject({ code: "EXP", status: "NAO_APLICAVEL" });
  });

  it("mostra erro em português quando o campo é inválido", async () => {
    const resolver = zodResolver(orderWithItemsSchema);
    const { errors } = await resolver(payload({ quantity: "" }), undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });

    expect(JSON.stringify(errors)).toContain("Quantidade é obrigatório");
    expect(JSON.stringify(errors)).not.toContain("Invalid input");
  });
});

describe("saveOrder -> applyPlan", () => {
  it("grava o pedido montado pelo formulário (regressão do bug de tipos)", async () => {
    const result = await saveOrder(client, ORDER);

    expect(result.code).toBe("OF-1234");
    expect(mocks.applyPlan).toHaveBeenCalledTimes(1);
    expect(readPlan().operations[0].item.quantity).toBe(5);
  });

  it("aceita quantidade em texto vindo da planilha", async () => {
    await saveOrder(client, payload({ quantity: "80,5" }));

    expect(readPlan().operations[0].item.quantity).toBe(80.5);
  });

  it("não grava nada quando a validação falha", async () => {
    await expect(saveOrder(client, payload({ quantity: "" }))).rejects.toThrow(
      "Quantidade é obrigatório",
    );

    expect(mocks.applyPlan).not.toHaveBeenCalled();
  });

  it("rejeita processo fora do catálogo ativo", async () => {
    await expect(saveOrder(client, payload({ processCodes: ["NAO_EXISTE"] }))).rejects.toThrow(
      "Processo inválido: NAO_EXISTE",
    );

    expect(mocks.applyPlan).not.toHaveBeenCalled();
  });

  it("impede duplicidade silenciosa do mesmo item pai", async () => {
    mocks.findItemsByOrderCodes.mockResolvedValueOnce(
      new Map([
        [
          "OF-1234::#VIGA 100X50",
          { id: "item-1", orderCode: "OF-1234", parentItem: "", description: "Viga 100x50" },
        ],
      ]),
    );

    await expect(saveOrder(client, ORDER)).rejects.toThrow(/Já existe um item/);

    expect(mocks.applyPlan).not.toHaveBeenCalled();
  });
});

describe("persistência da seleção de processos (022)", () => {
  const MP_CATALOG = {
    id: "9",
    code: "MP",
    name: "MP",
    displayOrder: 5,
    active: true,
    location: null,
    durationDays: 1,
  } as ProcessDefinition;

  function processByCode(code: string) {
    return readPlan().operations[0]?.item.processes.find((process) => process.code === code);
  }

  it("desmarcar sem linha prévia grava NAO_APLICAVEL (antes sumia do plano)", async () => {
    // Item novo: só LASER é selecionado — os demais precisam nascer
    // explicitamente "não aplicável" para não voltarem marcados na abertura.
    await saveOrder(client, payload({ processCodes: ["LASER"] }));

    expect(processByCode("LASER")).toMatchObject({ status: "NAO_INICIADO" });
    expect(processByCode("SOLDA")).toMatchObject({ status: "NAO_APLICAVEL" });
    expect(processByCode("EXP")).toMatchObject({ status: "NAO_APLICAVEL" });
  });

  it("desmarcar em item existente preserva quantidades e notas", async () => {
    mocks.getOrderItemWithProcesses.mockResolvedValueOnce({
      id: "item-1",
      processes: [
        {
          code: "LASER",
          status: "EM_ANDAMENTO",
          quantityPlanned: 10,
          quantityCompleted: 4,
          notes: "lote A",
        },
        {
          code: "SOLDA",
          status: "NAO_INICIADO",
          quantityPlanned: 8,
          quantityCompleted: 0,
          notes: null,
        },
      ],
    });

    await saveOrder(client, {
      ...ORDER,
      items: [{ ...ITEM, id: "item-1", processCodes: ["LASER"] }],
    });

    expect(readPlan().operations[0]?.action).toBe("UPDATE");
    expect(processByCode("LASER")).toMatchObject({
      status: "EM_ANDAMENTO",
      quantityPlanned: 10,
      quantityCompleted: 4,
      notes: "lote A",
    });
    expect(processByCode("SOLDA")).toMatchObject({
      status: "NAO_APLICAVEL",
      quantityPlanned: 8,
      quantityCompleted: 0,
    });
  });

  it("re-marcar processo NAO_APLICAVEL volta para NAO_INICIADO", async () => {
    mocks.getOrderItemWithProcesses.mockResolvedValueOnce({
      id: "item-1",
      processes: [
        {
          code: "LASER",
          status: "CONCLUIDO",
          quantityPlanned: 5,
          quantityCompleted: 5,
          notes: null,
        },
        {
          code: "SOLDA",
          status: "NAO_APLICAVEL",
          quantityPlanned: null,
          quantityCompleted: null,
          notes: null,
        },
      ],
    });

    await saveOrder(client, {
      ...ORDER,
      items: [{ ...ITEM, id: "item-1", processCodes: ["LASER", "SOLDA"] }],
    });

    // O avanço já gravado não se perde…
    expect(processByCode("LASER")).toMatchObject({ status: "CONCLUIDO" });
    // …e a remarcação finalmente grava (antes reenviava NAO_APLICAVEL).
    expect(processByCode("SOLDA")).toMatchObject({ status: "NAO_INICIADO" });
  });

  it("MP é selecionado mesmo fora do payload (pré-requisito da produção)", async () => {
    mocks.catalog.push(MP_CATALOG);
    try {
      await saveOrder(client, payload({ processCodes: ["LASER"] }));

      expect(processByCode("MP")).toMatchObject({ status: "NAO_INICIADO" });
      expect(processByCode("SOLDA")).toMatchObject({ status: "NAO_APLICAVEL" });
    } finally {
      mocks.catalog.pop();
    }
  });
});

describe("derivação de status pela OP (013)", () => {
  it("item com OP preenchida nasce EM_PRODUCAO e a OF acompanha", async () => {
    await saveOrder(client, payload({ op: "OP-777" }));

    const operation = readPlan().operations[0];
    expect(operation.item.op).toBe("OP-777");
    expect(operation.item.status).toBe("EM_PRODUCAO");
    expect(operation.order.status).toBe("EM_PRODUCAO");
  });

  it("item sem OP permanece em espera mesmo com processos selecionados", async () => {
    await saveOrder(client, payload({ op: "" }));

    const operation = readPlan().operations[0];
    expect(operation.item.op).toBeNull();
    expect(operation.item.status).toBe("PLANEJADO");
    expect(operation.order.status).toBe("PLANEJADO");
  });

  it("a derivação nunca sobrescreve uma OF cancelada", async () => {
    mocks.findOrdersByCodes.mockResolvedValueOnce(
      new Map([
        [
          "OF-1234",
          { id: "order-id-123", code: "OF-1234", status: "CANCELADO", deliveryDate: null },
        ],
      ]),
    );

    await saveOrder(client, payload({ op: "OP-777" }));

    expect(readPlan().operations[0].order.status).toBe("CANCELADO");
  });
});
