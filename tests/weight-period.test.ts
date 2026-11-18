import { describe, expect, it } from "vitest";

import {
  countBusinessDays,
  isWeekendISO,
  sumCompletedWeightBefore,
} from "../src/lib/utils/weight-period";

describe("isWeekendISO", () => {
  it("identifica sábado e domingo no calendário do negócio", () => {
    expect(isWeekendISO("2026-11-14")).toBe(true); // sábado
    expect(isWeekendISO("2026-11-15")).toBe(true); // domingo
    expect(isWeekendISO("2026-11-13")).toBe(false); // sexta
    expect(isWeekendISO("2026-11-16")).toBe(false); // segunda
  });

  it("ignora valores fora do formato AAAA-MM-DD", () => {
    expect(isWeekendISO("14/11/2026")).toBe(false);
    expect(isWeekendISO("")).toBe(false);
  });
});

describe("countBusinessDays", () => {
  it("conta seg–sex do período inteiro em períodos passados", () => {
    // Novembro/2026 tem 30 dias: 9 fins de semana -> 21 dias úteis.
    expect(countBusinessDays("2026-11-01", "2026-11-30", "2026-12-05")).toBe(21);
  });

  it("no período em curso deixa o dia atual fora da conta", () => {
    // De 01/11 (dom) até 16/11 (seg): 11 dias úteis encerrados.
    // O dia 17/11 (ter, hoje) NÃO entra na média.
    expect(countBusinessDays("2026-11-01", "2026-11-30", "2026-11-17")).toBe(11);
  });

  it("retorna zero quando o período não tem dia útil ou ainda não começou", () => {
    expect(countBusinessDays("2026-11-14", "2026-11-15", "2026-11-15")).toBe(0);
    expect(countBusinessDays("2026-12-01", "2026-12-31", "2026-11-17")).toBe(0);
  });

  it("retorna zero quando hoje é o primeiro dia do período", () => {
    expect(countBusinessDays("2026-11-02", "2026-11-06", "2026-11-02")).toBe(0);
  });

  it("considera os dois limites inclusive quando o período já encerrou", () => {
    // Segunda a sexta da mesma semana, com hoje já fora do período.
    expect(countBusinessDays("2026-11-02", "2026-11-06", "2026-11-17")).toBe(5);
  });
});

describe("sumCompletedWeightBefore", () => {
  const days = [
    {
      date: "2026-11-16",
      processes: [{ code: "MP", weightKg: 10, quantity: 2, cells: 1 }],
    },
    {
      date: "2026-11-17",
      processes: [
        { code: "MP", weightKg: 4, quantity: 1, cells: 1 },
        { code: "LASER", weightKg: 6, quantity: 3, cells: 1 },
      ],
    },
    {
      date: "2026-11-18",
      processes: [{ code: "MP", weightKg: 99, quantity: 9, cells: 1 }],
    },
  ];

  it("soma só os dias anteriores a hoje (o dia atual fica fora)", () => {
    const result = sumCompletedWeightBefore(days, "2026-11-18");

    expect(result.total).toBe(20);
    expect(result.byProcess.get("MP")).toBe(14);
    expect(result.byProcess.get("LASER")).toBe(6);
  });

  it("em período passado soma todos os dias", () => {
    const result = sumCompletedWeightBefore(days, "2026-11-25");

    expect(result.total).toBe(119);
    expect(result.byProcess.get("MP")).toBe(113);
  });
});
