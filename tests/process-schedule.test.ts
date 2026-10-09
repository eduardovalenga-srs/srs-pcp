import { describe, expect, it } from "vitest";

import { isBusinessDay } from "@/lib/utils/dates";
import {
  computeProcessSchedule,
  getProcessWindow,
  type ScheduleProcess,
} from "@/lib/utils/process-schedule";

/**
 * Fluxo enxuto: LASER (2) → SOLDA (3) → EXP (1).
 * Referência de calendário: 2026-10-05 = segunda, 09 = sexta,
 * 10 = sábado e 11 = domingo.
 */
const flow: ScheduleProcess[] = [
  { code: "LASER", displayOrder: 10, durationDays: 2 },
  { code: "SOLDA", displayOrder: 20, durationDays: 3 },
  { code: "EXP", displayOrder: 30, durationDays: 1 },
];

describe("computeProcessSchedule (dias úteis)", () => {
  it("expedição acontece no dia útil anterior à entrega (sábado vira sexta)", () => {
    const schedule = computeProcessSchedule("2026-10-10", flow);

    // EXP = expedição: dia útil anterior à entrega (sex 09/10).
    expect(schedule.get("EXP")).toEqual({ start: "2026-10-09", end: "2026-10-09" });
    // SOLDA: 3 dias úteis terminando no dia útil anterior (qui 08 → ter 06).
    expect(schedule.get("SOLDA")).toEqual({ start: "2026-10-06", end: "2026-10-08" });
    // LASER: 2 dias úteis (sex 02 → seg 05), pulando o fim de semana.
    expect(schedule.get("LASER")).toEqual({ start: "2026-10-02", end: "2026-10-05" });
  });

  it("entrega no sábado e no domingo produzem o mesmo plano (expedição na sexta)", () => {
    expect(computeProcessSchedule("2026-10-11", flow)).toEqual(
      computeProcessSchedule("2026-10-10", flow),
    );
  });

  it("entrega na segunda: expedição na sexta anterior, sem buracos", () => {
    const schedule = computeProcessSchedule("2026-10-05", flow);

    expect(schedule.get("EXP")).toEqual({ start: "2026-10-02", end: "2026-10-02" });
    expect(schedule.get("SOLDA")).toEqual({ start: "2026-09-29", end: "2026-10-01" });
    expect(schedule.get("LASER")).toEqual({ start: "2026-09-25", end: "2026-09-28" });
  });

  it("nunca agenda sábado ou domingo em nenhuma janela", () => {
    const schedule = computeProcessSchedule("2026-10-10", flow);
    for (const window of schedule.values()) {
      expect(isBusinessDay(window.start), `início ${window.start}`).toBe(true);
      expect(isBusinessDay(window.end), `fim ${window.end}`).toBe(true);
    }
  });

  it("ordena pela ordem de exibição mesmo com a lista embaralhada", () => {
    const shuffled = [flow[2], flow[0], flow[1]];
    const schedule = computeProcessSchedule("2026-10-10", shuffled);

    expect(schedule.get("LASER")).toEqual({ start: "2026-10-02", end: "2026-10-05" });
    expect(schedule.get("SOLDA")).toEqual({ start: "2026-10-06", end: "2026-10-08" });
    expect(schedule.get("EXP")).toEqual({ start: "2026-10-09", end: "2026-10-09" });
  });

  it("janelas consecutivas em dias úteis (sem buracos e sem fim de semana)", () => {
    const schedule = computeProcessSchedule("2026-10-10", flow);
    const ordered = ["LASER", "SOLDA", "EXP"].map((code) => schedule.get(code)!);

    for (let i = 1; i < ordered.length; i += 1) {
      // O início do próximo é exatamente o dia útil após o fim do anterior.
      const nextStart = new Date(`${ordered[i].start}T00:00:00`);
      const previousEnd = new Date(`${ordered[i - 1].end}T00:00:00`);
      const cursor = new Date(previousEnd);
      do {
        cursor.setDate(cursor.getDate() + 1);
      } while (cursor.getDay() === 0 || cursor.getDay() === 6);
      expect(cursor.getTime()).toBe(nextStart.getTime());
    }
  });

  it("processo único atravessa o fim de semana contando só dias úteis", () => {
    // Entrega na segunda: expedição na sexta 02/10; 4 dias úteis → ter 29/09.
    const schedule = computeProcessSchedule("2026-10-05", [
      { code: "UNICO", displayOrder: 1, durationDays: 4 },
    ]);
    expect(schedule.get("UNICO")).toEqual({ start: "2026-09-29", end: "2026-10-02" });
  });

  it("cruza mês e ano sem perder dias", () => {
    // Entrega sex 02/01/2026 → expedição qui 01/01; 3 dias úteis (feriados não valem).
    const schedule = computeProcessSchedule("2026-01-02", [
      { code: "UNICO", displayOrder: 1, durationDays: 3 },
    ]);
    expect(schedule.get("UNICO")).toEqual({ start: "2025-12-30", end: "2026-01-01" });
  });

  it("trata duração inválida como 1 dia útil", () => {
    const schedule = computeProcessSchedule("2026-10-09", [
      { code: "ZERO", displayOrder: 1, durationDays: 0 },
    ]);
    // Entrega na sexta → expedição na quinta 08/10.
    expect(schedule.get("ZERO")).toEqual({ start: "2026-10-08", end: "2026-10-08" });
  });

  it("sem data de entrega não há planejamento", () => {
    expect(computeProcessSchedule(null, flow).size).toBe(0);
    expect(computeProcessSchedule(undefined, flow).size).toBe(0);
    expect(computeProcessSchedule("", flow).size).toBe(0);
    expect(computeProcessSchedule("10/10/2026", flow).size).toBe(0);
    expect(computeProcessSchedule("2026-02-30", flow).size).toBe(0);
  });

  it("lista vazia de processos devolve mapa vazio", () => {
    expect(computeProcessSchedule("2026-10-10", []).size).toBe(0);
  });
});

describe("getProcessWindow", () => {
  it("devolve a janela do processo pedido", () => {
    expect(getProcessWindow("2026-10-10", flow, "SOLDA")).toEqual({
      start: "2026-10-06",
      end: "2026-10-08",
    });
  });

  it("devolve null para código fora do fluxo ou sem entrega", () => {
    expect(getProcessWindow("2026-10-10", flow, "PINTURA")).toBeNull();
    expect(getProcessWindow(null, flow, "LASER")).toBeNull();
  });
});

describe("MP na frente da cadeia (migration 021)", () => {
  it("incluir um processo anterior não desloca as janelas dos demais", () => {
    const base = computeProcessSchedule("2026-10-10", flow);
    const withMP = computeProcessSchedule("2026-10-10", [
      { code: "MP", displayOrder: 5, durationDays: 1 },
      ...flow,
    ]);

    // Cada janela existente fica exatamente onde estava (passo de trás
    // para frente: só o vizinho da direita importa).
    for (const { code } of flow) {
      expect(withMP.get(code)).toEqual(base.get(code));
    }
    // MP ocupa o dia útil anterior ao início da LASER (qui 01/10).
    expect(withMP.get("MP")).toEqual({ start: "2026-10-01", end: "2026-10-01" });
  });
});
