import { describe, expect, it } from "vitest";

import {
  allowedProcessStatuses,
  applicableProcesses,
  calculateProgress,
  countPendingProcesses,
  deriveOrderItemStatus,
  deriveOrderStatus,
  fabrica1ItemProcesses,
  isItemOverdue,
  isProcessStartOverdue,
} from "@/lib/utils/production";
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
      isItemOverdue({ deliveryDate: "2026-09-30", processStatuses: { EXP: "EM_ANDAMENTO" } }, today),
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
    expect(isProcessStartOverdue("2026-09-30", "EM_ANDAMENTO", today)).toBe(true);
    expect(isProcessStartOverdue("2026-09-30", "NAO_INICIADO", today)).toBe(true);
    expect(isProcessStartOverdue("2026-09-30", "BLOQUEADO", today)).toBe(true);
    expect(isProcessStartOverdue("2026-09-30", null, today)).toBe(true);
  });

  it("processo CONCLUIDO nunca fica vermelho", () => {
    expect(isProcessStartOverdue("2026-09-30", "CONCLUIDO", today)).toBe(false);
  });

  it("início hoje ou futuro não é vencido", () => {
    expect(isProcessStartOverdue(today, "EM_ANDAMENTO", today)).toBe(false);
    expect(isProcessStartOverdue("2026-10-05", "EM_ANDAMENTO", today)).toBe(false);
  });

  it("sem data de início não há o que marcar", () => {
    expect(isProcessStartOverdue(null, "EM_ANDAMENTO", today)).toBe(false);
    expect(isProcessStartOverdue(undefined, "EM_ANDAMENTO", today)).toBe(false);
    expect(isProcessStartOverdue("", "EM_ANDAMENTO", today)).toBe(false);
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
      deriveOrderItemStatus([state("LASER", "CONCLUIDO"), state("SOLDA", "EM_ANDAMENTO")], "OP-1234"),
    ).toBe("EM_PRODUCAO");
    // OP preenchida já basta — mesmo sem processo em andamento.
    expect(
      deriveOrderItemStatus([state("LASER", "NAO_INICIADO"), state("SOLDA", "BLOQUEADO")], "OP-1234"),
    ).toBe("EM_PRODUCAO");
  });

  it("fica em espera quando a OP está em branco (mesmo com processo ativo)", () => {
    expect(
      deriveOrderItemStatus([state("LASER", "CONCLUIDO"), state("SOLDA", "EM_ANDAMENTO")], null),
    ).toBe("PLANEJADO");
    expect(
      deriveOrderItemStatus([state("LASER", "NAO_INICIADO"), state("SOLDA", "EM_ANDAMENTO")], "   "),
    ).toBe("PLANEJADO");
  });

  it("fica em espera quando há pendência sem início (mesmo com bloqueio)", () => {
    expect(
      deriveOrderItemStatus([state("LASER", "NAO_INICIADO"), state("SOLDA", "BLOQUEADO")], null),
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
    expect(allowedProcessStatuses("MP")).not.toContain("EM_ANDAMENTO");
    expect(allowedProcessStatuses("MP")).not.toContain("BLOQUEADO");
    expect(allowedProcessStatuses("MP")).not.toContain("NAO_APLICAVEL");
  });

  it("os demais processos mantêm o catálogo completo", () => {
    expect(allowedProcessStatuses("LASER")).toHaveLength(5);
    expect(allowedProcessStatuses("EXP")).toContain("EM_ANDAMENTO");
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
      makeProcess("LASER", 10, "EM_ANDAMENTO"),
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
      makeProcess("EXP", 130, "EM_ANDAMENTO"),
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
