import { describe, expect, it } from "vitest";

import {
  addBusinessDays,
  formatDayMonth,
  isBusinessDay,
  previousBusinessDay,
  subBusinessDays,
} from "@/lib/utils/dates";

/**
 * Calendário de referência: 2026-10-05 = segunda, 09 = sexta,
 * 10 = sábado e 11 = domingo.
 */
describe("isBusinessDay", () => {
  it("segunda a sexta são dias úteis", () => {
    expect(isBusinessDay("2026-10-05")).toBe(true); // segunda
    expect(isBusinessDay("2026-10-09")).toBe(true); // sexta
  });

  it("sábado e domingo não são dias úteis", () => {
    expect(isBusinessDay("2026-10-10")).toBe(false);
    expect(isBusinessDay("2026-10-11")).toBe(false);
  });

  it("data ilegível não é dia útil", () => {
    expect(isBusinessDay("lixo")).toBe(false);
    expect(isBusinessDay("2026-02-30")).toBe(false);
  });
});

describe("previousBusinessDay", () => {
  it("pula sábado e domingo para trás", () => {
    expect(previousBusinessDay("2026-10-10")).toBe("2026-10-09"); // sáb → sex
    expect(previousBusinessDay("2026-10-11")).toBe("2026-10-09"); // dom → sex
  });

  it("de sexta vai para quinta e de segunda para a sexta anterior", () => {
    expect(previousBusinessDay("2026-10-09")).toBe("2026-10-08");
    expect(previousBusinessDay("2026-10-05")).toBe("2026-10-02"); // seg → sex
  });

  it("data ilegível volta intacta", () => {
    expect(previousBusinessDay("lixo")).toBe("lixo");
  });
});

describe("subBusinessDays", () => {
  it("0 dias devolve a própria data", () => {
    expect(subBusinessDays("2026-10-09", 0)).toBe("2026-10-09");
  });

  it("subtrai apenas dias úteis", () => {
    expect(subBusinessDays("2026-10-09", 1)).toBe("2026-10-08"); // sex → qui
    expect(subBusinessDays("2026-10-05", 1)).toBe("2026-10-02"); // seg → sex
    expect(subBusinessDays("2026-10-05", 4)).toBe("2026-09-29"); // pula o fim de semana
  });

  it("valor negativo ou ilegível não anda", () => {
    expect(subBusinessDays("2026-10-09", -3)).toBe("2026-10-09");
    expect(subBusinessDays("lixo", 2)).toBe("lixo");
  });
});

describe("addBusinessDays", () => {
  it("0 dias devolve a própria data (dia útil)", () => {
    expect(addBusinessDays("2026-10-09", 0)).toBe("2026-10-09");
  });

  it("soma apenas dias úteis para frente", () => {
    expect(addBusinessDays("2026-10-05", 1)).toBe("2026-10-06"); // seg → ter
    expect(addBusinessDays("2026-10-05", 4)).toBe("2026-10-09"); // seg → sex
    expect(addBusinessDays("2026-10-09", 1)).toBe("2026-10-12"); // sex → seg (pula o fim de semana)
  });

  it("partida em fim de semana rola para a segunda antes de somar", () => {
    expect(addBusinessDays("2026-10-10", 0)).toBe("2026-10-12"); // sáb → seg
    expect(addBusinessDays("2026-10-11", 1)).toBe("2026-10-13"); // dom → ter
  });

  it("valor negativo ou ilegível não anda", () => {
    expect(addBusinessDays("2026-10-09", -3)).toBe("2026-10-09");
    expect(addBusinessDays("lixo", 2)).toBe("lixo");
  });
});

describe("formatDayMonth", () => {
  it("formata apenas dia e mês (dd/MM)", () => {
    expect(formatDayMonth("2026-10-05")).toBe("05/10");
  });

  it("sem data ou com lixo devolve travessão", () => {
    expect(formatDayMonth(null)).toBe("—");
    expect(formatDayMonth(undefined)).toBe("—");
    expect(formatDayMonth("lixo")).toBe("—");
  });
});
