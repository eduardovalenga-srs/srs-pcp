import { describe, expect, it } from "vitest";

import { countBusinessDays, isWeekendISO } from "../src/lib/utils/weight-period";

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

  it("no período em curso conta só os dias úteis já transcorridos", () => {
    // De 01/11 (dom) até 17/11 (ter): 12 dias úteis.
    expect(countBusinessDays("2026-11-01", "2026-11-30", "2026-11-17")).toBe(12);
  });

  it("retorna zero quando o período não tem dia útil ou ainda não começou", () => {
    expect(countBusinessDays("2026-11-14", "2026-11-15", "2026-11-15")).toBe(0);
    expect(countBusinessDays("2026-12-01", "2026-12-31", "2026-11-17")).toBe(0);
  });

  it("considera os dois limites inclusive", () => {
    // Segunda a sexta da mesma semana.
    expect(countBusinessDays("2026-11-02", "2026-11-06", "2026-11-17")).toBe(5);
  });
});
