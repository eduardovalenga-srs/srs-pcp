import { describe, expect, it } from "vitest";

import {
  allowedProcessStatuses,
  applicableProcesses,
  calculateProgress,
  concludedProcessesToReset,
  countPendingProcesses,
  deriveOrderItemStatus,
  deriveOrderStatus,
  fabrica1ItemProcesses,
  fabrica1ProcessColumns,
  isItemOverdue,
  isProcessStartOverdue,
  predecessorsToComplete,
} from "@/lib/utils/production";
import { FABRICA1_EDITABLE_PROCESS_CODES } from "@/lib/constants/processes";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { calculateTotalWeight, formatQuantity, formatWeight, toNumber } from "@/lib/utils/formatting";
import type { ProcessState } from "@/lib/utils/production";
import type { ProcessStatus } from "@/lib/constants/production";

const state = (processCode: string, status: ProcessState["status"]): ProcessState => ({
  processCode,
  status,
});

describe("regra de atraso (item 13)", () => {
  const today = "2026-10-01";

  it("atrasado quando a entrega é anterior a hoje e a expedição não está concluída", () => {
    expect(
      isItemOverdue({ deliveryDate: "2026-09-30", processStatuses: { EXP: "NAO_INICIADO" } }, today),
    ).toBe(true);
    expect(
      isItemOverdue({ deliveryDate: "2026-09-30", processStatuses: {} }, today),
    ).toBe(true);
  });

  it("não é atrasado quando a expedição está concluída", () => {
    expect(
      isItemOverdue({ deliveryDate: "2026-09-30", processStatuses: { EXP: "CONCLUIDO" } }, today),
    ).toBe(false);
  });

  it("não é atrasado com entrega hoje ou futura", () => {
    expect(isItemOverdue({ deliveryDate: today, processStatuses: {} }, today)).toBe(false);
    expect(isItemOverdue({ deliveryDate: "2026-10-05", processStatuses: {} }, today)).toBe(false);
  });

  it("sem data de entrega nunca fica atrasado", () => {
    expect(isItemOverdue({ deliveryDate: null, processStatuses: {} }, today)).toBe(false);
  });
});

describe("cor de data vencida (processo concluído fica neutro)", () => {
  const today = "2026-10-01";

  it("marca vencido quando o início é anterior à data de referência", () => {
    expect(isProcessStartOverdue("2026-09-30", "NAO_APLICAVEL", today)).toBe(true);
    expect(isProcessStartOverdue("2026-09-30", "NAO_INICIADO", today)).toBe(true);
    expect(isProcessStartOverdue("2026-09-30", null, today)).toBe(true);
  });

  it("processo CONCLUIDO nunca fica vermelho", () => {
    expect(isProcessStartOverdue("2026-09-30", "CONCLUIDO", today)).toBe(false);
  });

  it("início hoje ou futuro não é vencido", () => {
    expect(isProcessStartOverdue(today, "NAO_INICIADO", today)).toBe(false);
    expect(isProcessStartOverdue("2026-10-05", "NAO_INICIADO", today)).toBe(false);
  });

  it("sem data de início não há o que marcar", () => {
    expect(isProcessStartOverdue(null, "NAO_INICIADO", today)).toBe(false);
    expect(isProcessStartOverdue(undefined, "NAO_INICIADO", today)).toBe(false);
    expect(isProcessStartOverdue("", "NAO_INICIADO", today)).toBe(false);
  });
});

describe("status derivado do item (regra 62: nada conclui sozinho + OP 013)", () => {
  it("só conclui quando todos os aplicáveis estão concluídos (mesmo sem OP)", () => {
    expect(
      deriveOrderItemStatus([state("LASER", "CONCLUIDO"), state("SOLDA", "CONCLUIDO")], null),
    ).toBe("CONCLUIDO");
    expect(
      deriveOrderItemStatus([state("LASER", "CONCLUIDO"), state("SOLDA", "NAO_APLICAVEL")], null),
    ).toBe("CONCLUIDO");
  });

  it("fica em produção quando a OP está preenchida", () => {
    expect(
      deriveOrderItemStatus([state("LASER", "CONCLUIDO"), state("SOLDA", "NAO_INICIADO")], "OP-1234"),
    ).toBe("EM_PRODUCAO");
    // OP preenchida já basta — mesmo sem nenhum processo concluído.
    expect(
      deriveOrderItemStatus([state("LASER", "NAO_INICIADO"), state("SOLDA", "NAO_INICIADO")], "OP-1234"),
    ).toBe("EM_PRODUCAO");
  });

  it("fica em espera quando a OP está em branco (mesmo com processo concluído)", () => {
    expect(
      deriveOrderItemStatus([state("LASER", "CONCLUIDO"), state("SOLDA", "NAO_INICIADO")], null),
    ).toBe("PLANEJADO");
    expect(
      deriveOrderItemStatus([state("LASER", "NAO_INICIADO"), state("SOLDA", "NAO_INICIADO")], "   "),
    ).toBe("PLANEJADO");
  });

  it("fica em espera quando há pendência sem início", () => {
    expect(
      deriveOrderItemStatus([state("LASER", "NAO_INICIADO"), state("SOLDA", "NAO_INICIADO")], null),
    ).toBe("PLANEJADO");
  });
});

describe("status derivado do pedido (013)", () => {
  it("conclui quando todos os itens concluíram", () => {
    expect(deriveOrderStatus(["CONCLUIDO", "CONCLUIDO"])).toBe("CONCLUIDO");
  });

  it("fica em produção se algum item está em produção", () => {
    expect(deriveOrderStatus(["EM_PRODUCAO", "PLANEJADO"])).toBe("EM_PRODUCAO");
  });

  it("fica em espera quando nenhum item tem OP", () => {
    expect(deriveOrderStatus(["PLANEJADO"])).toBe("PLANEJADO");
    expect(deriveOrderStatus([])).toBe("PLANEJADO");
  });
});

describe("progresso e pendências", () => {
  it("ignora processos não aplicáveis no cálculo", () => {
    const processes = [
      state("LASER", "CONCLUIDO"),
      state("SOLDA", "NAO_INICIADO"),
      state("KIT", "NAO_APLICAVEL"),
    ];
    expect(countPendingProcesses(processes)).toBe(1);
    expect(calculateProgress(processes)).toBe(50);
  });

  it("sem processos aplicáveis o progresso é 100%", () => {
    expect(calculateProgress([state("KIT", "NAO_APLICAVEL")])).toBe(100);
    expect(countPendingProcesses([state("KIT", "NAO_APLICAVEL")])).toBe(0);
  });
});

describe("situações permitidas por processo (regra do MP)", () => {
  it("MP aceita somente não iniciado e concluído", () => {
    expect(allowedProcessStatuses("MP")).toEqual(["NAO_INICIADO", "CONCLUIDO"]);
    expect(allowedProcessStatuses("MP")).not.toContain("NAO_APLICAVEL");
  });

  it("os demais processos mantêm o catálogo completo", () => {
    expect(allowedProcessStatuses("LASER")).toHaveLength(3);
    expect(allowedProcessStatuses("EXP")).toEqual(["NAO_INICIADO", "CONCLUIDO", "NAO_APLICAVEL"]);
    expect(allowedProcessStatuses("QUALITY")).toContain("NAO_APLICAVEL");
  });
});

describe("formatação de datas e números", () => {
  it("formata datas no padrão brasileiro e trata ausências", () => {
    expect(formatDate("2026-10-05")).toBe("05/10/2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("data-invalida")).toBe("—");
    expect(formatDateTime("2026-10-05T14:30:00")).toMatch(/^05\/10\/2026 \d{2}:\d{2}$/);
  });

  it("aceita vírgula decimal e mantém inteiros legíveis", () => {
    expect(toNumber("80,5")).toBe(80.5);
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(formatQuantity(10)).toBe("10");
    expect(formatQuantity(10.5)).toBe("10,5");
    expect(formatQuantity(null)).toBe("—");
    expect(formatWeight(12.345)).toBe("12,345");
  });
});

describe("peso total do item (Fábrica 1: quantidade × peso unitário)", () => {
  it("é a multiplicação simples da quantidade pelo peso unitário", () => {
    expect(calculateTotalWeight(4, 12.5)).toBe(50);
    expect(calculateTotalWeight(3, 0.333)).toBeCloseTo(0.999, 3);
  });

  it("sem peso unitário não há total (nada de inventar número)", () => {
    expect(calculateTotalWeight(10, null)).toBeNull();
    expect(calculateTotalWeight(null, 5)).toBeNull();
  });
});

describe("processos aplicáveis de um item (Fábrica 1)", () => {
  const makeProcess = (code: string, displayOrder: number, status: ProcessStatus) => ({
    code,
    displayOrder,
    status,
  });

  it("remove os não aplicáveis e ordena por ordem fabril", () => {
    const processes = [
      makeProcess("EXP", 60, "CONCLUIDO"),
      makeProcess("FICEP", 50, "NAO_APLICAVEL"),
      makeProcess("LASER", 10, "NAO_INICIADO"),
      makeProcess("DOB", 20, "NAO_INICIADO"),
    ];
    const result = applicableProcesses(processes);
    expect(result.map((process) => process.code)).toEqual(["LASER", "DOB", "EXP"]);
  });

  it("não muta a lista original", () => {
    const processes = [
      makeProcess("B", 2, "NAO_INICIADO"),
      makeProcess("A", 1, "NAO_INICIADO"),
    ];
    const originalOrder = processes.map((process) => process.code);
    applicableProcesses(processes);
    expect(processes.map((process) => process.code)).toEqual(originalOrder);
  });

  it("retorna vazio quando todo o item é não aplicável", () => {
    expect(applicableProcesses([makeProcess("MP", 1, "NAO_APLICAVEL")])).toEqual([]);
  });
});

describe("processos visíveis na Fábrica 1 (MP primeiro, some depois do KIT)", () => {
  const makeProcess = (
    code: string,
    displayOrder: number,
    status: ProcessStatus = "NAO_INICIADO",
  ) => ({ code, displayOrder, status });

  it("coloca o MP na primeira posição e para no KIT", () => {
    const chain = [
      makeProcess("LASER", 10),
      makeProcess("PUNC", 50),
      makeProcess("MP", 55),
      makeProcess("FICEP", 70),
      makeProcess("KIT", 80),
      makeProcess("SOLDA", 100),
      makeProcess("EXP", 130, "NAO_INICIADO"),
    ];
    expect(fabrica1ItemProcesses(chain).map((process) => process.code)).toEqual([
      "MP",
      "LASER",
      "PUNC",
      "FICEP",
      "KIT",
    ]);
  });

  it("esconde o que vem depois do KIT mesmo com o KIT não aplicável", () => {
    const chain = [
      makeProcess("LASER", 10),
      makeProcess("KIT", 80, "NAO_APLICAVEL"),
      makeProcess("EXP", 130),
    ];
    expect(fabrica1ItemProcesses(chain).map((process) => process.code)).toEqual(["LASER"]);
  });

  it("sem KIT no item a lista segue aberta (não aplicáveis continuam fora)", () => {
    const chain = [makeProcess("EXP", 130), makeProcess("LASER", 10, "NAO_APLICAVEL")];
    expect(fabrica1ItemProcesses(chain).map((process) => process.code)).toEqual(["EXP"]);
  });
});

describe("colunas de processos da tabela da Fábrica 1", () => {
  const catalog = [
    { code: "MP", displayOrder: 5 },
    { code: "LASER", displayOrder: 10 },
    { code: "DB_CH", displayOrder: 20 },
    { code: "SERRA", displayOrder: 30 },
    { code: "DB_TB", displayOrder: 40 },
    { code: "PUNC", displayOrder: 50 },
    { code: "METALEIRA", displayOrder: 60 },
    { code: "FICEP", displayOrder: 70 },
    { code: "KIT", displayOrder: 80 },
    { code: "PRE_MTG", displayOrder: 90 },
    { code: "SOLDA", displayOrder: 100 },
    { code: "ACAB", displayOrder: 110 },
    { code: "QUALITY", displayOrder: 120 },
    { code: "EXP", displayOrder: 130 },
  ];

  it("mantém só a cadeia da Fábrica 1 (MP → KIT) na ordem do catálogo", () => {
    expect(fabrica1ProcessColumns(catalog).map((process) => process.code)).toEqual([
      "MP",
      "LASER",
      "DB_CH",
      "SERRA",
      "DB_TB",
      "PUNC",
      "METALEIRA",
      "FICEP",
      "KIT",
    ]);
  });

  it("abre com o MP mesmo quando o catálogo divide o display_order (MP = PUNC = 5)", () => {
    // É o estado real do banco: a migration 021 gravou o MP com display_order 5
    // e o catálogo já usava 5 para o PUNC — ordenar só por número o deixaria
    // no meio da cadeia.
    const realCatalog = [
      { code: "LASER", displayOrder: 1 },
      { code: "PUNC", displayOrder: 5 },
      { code: "MP", displayOrder: 5 },
      { code: "KIT", displayOrder: 8 },
    ];
    expect(fabrica1ProcessColumns(realCatalog).map((process) => process.code)).toEqual([
      "MP",
      "LASER",
      "PUNC",
      "KIT",
    ]);
  });

  it("ignora processos de fora da cadeia (o pós-KIT fica na gestão de entregas)", () => {
    expect(fabrica1ProcessColumns([{ code: "SOLDA", displayOrder: 100 }])).toEqual([]);
    expect(fabrica1ProcessColumns([{ code: "EXP", displayOrder: 130 }])).toEqual([]);
  });

  it("edita nesta tela só as etapas de sub-item e o KIT — nunca o MP", () => {
    const editable = new Set(FABRICA1_EDITABLE_PROCESS_CODES);
    expect(editable.has("MP")).toBe(false);
    expect(editable.has("LASER")).toBe(true);
    expect(editable.has("METALEIRA")).toBe(true);
    expect(editable.has("KIT")).toBe(true);
    expect(editable.has("SOLDA")).toBe(false);
    expect(editable.has("EXP")).toBe(false);
  });
});

describe("cascata da linha do tempo (regra 62 revisada)", () => {
  const chain: { code: string; displayOrder: number; status: ProcessStatus }[] = [
    { code: "MP", displayOrder: 5, status: "NAO_INICIADO" },
    { code: "LASER", displayOrder: 10, status: "NAO_INICIADO" },
    { code: "DB_CH", displayOrder: 20, status: "CONCLUIDO" },
    { code: "SERRA", displayOrder: 30, status: "NAO_APLICAVEL" },
    { code: "KIT", displayOrder: 70, status: "NAO_INICIADO" },
    { code: "SOLDA", displayOrder: 90, status: "CONCLUIDO" },
    { code: "QUALITY", displayOrder: 110, status: "NAO_INICIADO" },
    { code: "EXP", displayOrder: 120, status: "CONCLUIDO" },
  ];

  it("conclusão puxa só os predecessores NAO_INICIADO, na ordem da linha do tempo", () => {
    expect(predecessorsToComplete(chain, "KIT").map((process) => process.code)).toEqual([
      "MP",
      "LASER",
    ]);
    // DB_CH (já concluído) e SERRA (não aplicável) ficam de fora do meio;
    // KIT entra como restante não iniciado antes de SOLDA.
    expect(predecessorsToComplete(chain, "SOLDA").map((process) => process.code)).toEqual([
      "MP",
      "LASER",
      "KIT",
    ]);
  });

  it("alvo ausente ou fora da linha do tempo não dispara nada", () => {
    expect(predecessorsToComplete(chain, "PUNC")).toEqual([]);
    expect(predecessorsToComplete(chain, "SERRA")).toEqual([]);
    expect(concludedProcessesToReset(chain, "SERRA")).toEqual([]);
  });

  it("reinício da linha devolve os concluídos antes e depois do alvo", () => {
    // DB_CH antes e EXP depois (SOLDA é o alvo; QUALITY não aplicável fica).
    expect(concludedProcessesToReset(chain, "SOLDA").map((process) => process.code)).toEqual([
      "DB_CH",
      "EXP",
    ]);
    expect(concludedProcessesToReset(chain, "KIT").map((process) => process.code)).toEqual([
      "DB_CH",
      "SOLDA",
      "EXP",
    ]);
  });

  it("não há o que concluir/devolver quando a linha já está certa", () => {
    const done: { code: string; displayOrder: number; status: ProcessStatus }[] = [
      { code: "MP", displayOrder: 5, status: "CONCLUIDO" },
      { code: "LASER", displayOrder: 10, status: "NAO_INICIADO" },
    ];
    expect(predecessorsToComplete(done, "LASER")).toEqual([]);
    // o único concluído é o próprio alvo — a linha inteira não muda
    expect(concludedProcessesToReset(done, "MP")).toEqual([]);
  });

  it("ordena por displayOrder com desempate pelo código e não muta a lista", () => {
    const unsorted: { code: string; displayOrder: number; status: ProcessStatus }[] = [
      { code: "LASER", displayOrder: 10, status: "NAO_INICIADO" },
      { code: "MP", displayOrder: 5, status: "NAO_INICIADO" },
    ];
    expect(predecessorsToComplete(unsorted, "LASER").map((process) => process.code)).toEqual([
      "MP",
    ]);
    expect(unsorted.map((process) => process.code)).toEqual(["LASER", "MP"]);
  });
});
