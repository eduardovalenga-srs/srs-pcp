import { describe, expect, it } from "vitest";

import { ACAB_PROCESS_CODE, SHIPMENT_PROCESS_CODE } from "@/lib/constants/processes";
import type { ProcessCell } from "@/lib/types/production";
import {
  acabWindowForItem,
  isAcabOverdue,
  productionRowsTotals,
} from "@/lib/utils/production";

/**
 * REGRA DO ACAB — card "Atrasados" da Fábrica 2: o item conta quando a data
 * da coluna ACAB (início previsto da janela) é anterior à data de referência.
 *
 * 2026-10-20 é terça-feira; as datas dos fixtures caem em dias conhecidos
 * (10-16 sexta, 10-23 sexta, 10-27 terça).
 */
const TODAY = "2026-10-20";

/** Mesmo catálogo com que a tabela calcula as janelas (código + ordem + duração). */
const CATALOG = [
  { code: ACAB_PROCESS_CODE, displayOrder: 110, durationDays: 2 },
  { code: "QUALITY", displayOrder: 120, durationDays: 1 },
  { code: SHIPMENT_PROCESS_CODE, displayOrder: 130, durationDays: 1 },
];

function cell(status: ProcessCell["status"]): ProcessCell {
  return {
    id: `pp-${status}`,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
  };
}

/** Item da Fábrica 2 com apenas os campos que a regra lê. */
function item(
  overrides: Partial<{
    deliveryDate: string | null;
    acab: ProcessCell["status"] | null;
    exp: ProcessCell["status"] | null;
  }> = {},
) {
  const { deliveryDate = "2026-10-16", acab = "NAO_INICIADO", exp = "NAO_INICIADO" } = overrides;
  const processes: Record<string, ProcessCell> = {};
  if (acab !== null) processes[ACAB_PROCESS_CODE] = cell(acab);
  processes.QUALITY = cell("NAO_INICIADO");
  if (exp !== null) processes[SHIPMENT_PROCESS_CODE] = cell(exp);
  return { deliveryDate, processes };
}

describe("janela do ACAB no item da Fábrica 2", () => {
  it("reproduz a janela da célula ACAB (dias úteis de trás para frente da entrega)", () => {
    // Entrega sexta 16/10: EXP e QUALITY ocupam 1 dia útil cada antes dela
    // e o ACAB tem 2 dias úteis — começa na segunda 12/10 e termina 13/10.
    expect(acabWindowForItem(item(), CATALOG)).toEqual({
      start: "2026-10-12",
      end: "2026-10-13",
    });
  });

  it("sem data de entrega não há janela", () => {
    expect(acabWindowForItem(item({ deliveryDate: null }), CATALOG)).toBeNull();
  });

  it("ACAB desmarcado (NAO_APLICAVEL) não ocupa dias nem ganha janela", () => {
    expect(acabWindowForItem(item({ acab: "NAO_APLICAVEL" }), CATALOG)).toBeNull();
  });
});

describe("isAcabOverdue — card Atrasados da Fábrica 2", () => {
  it("conta quando o início do ACAB é anterior a hoje", () => {
    expect(isAcabOverdue(item(), CATALOG, TODAY)).toBe(true);
  });

  it("conta quando o início do ACAB é a véspera", () => {
    // Entrega 23/10 (sexta) → início do ACAB 19/10 (segunda).
    const atrasado = item({ deliveryDate: "2026-10-23" });
    expect(acabWindowForItem(atrasado, CATALOG)?.start).toBe("2026-10-19");
    expect(isAcabOverdue(atrasado, CATALOG, TODAY)).toBe(true);
  });

  it("não conta quando o início do ACAB é hoje ou futuro", () => {
    // Entrega 27/10 (terça) → início do ACAB 21/10 (quarta).
    const futuro = item({ deliveryDate: "2026-10-27" });
    expect(acabWindowForItem(futuro, CATALOG)?.start).toBe("2026-10-21");
    expect(isAcabOverdue(futuro, CATALOG, TODAY)).toBe(false);

    // Entrega 26/10 (segunda) → início do ACAB 20/10 (hoje).
    const hoje = item({ deliveryDate: "2026-10-26" });
    expect(acabWindowForItem(hoje, CATALOG)?.start).toBe("2026-10-20");
    expect(isAcabOverdue(hoje, CATALOG, TODAY)).toBe(false);
  });

  it("ACAB CONCLUIDO nunca fica atrasado (data passada é esperada)", () => {
    expect(isAcabOverdue(item({ acab: "CONCLUIDO" }), CATALOG, TODAY)).toBe(false);
  });

  it("ACAB NAO_APLICAVEL ou ausente no item não conta", () => {
    expect(isAcabOverdue(item({ acab: "NAO_APLICAVEL" }), CATALOG, TODAY)).toBe(false);
    expect(isAcabOverdue(item({ acab: null }), CATALOG, TODAY)).toBe(false);
  });

  it("sem data de entrega nunca fica atrasado", () => {
    expect(isAcabOverdue(item({ deliveryDate: null }), CATALOG, TODAY)).toBe(false);
  });

  it("não depende da expedição: EXP concluída não esconde o ACAB vencido", () => {
    expect(isAcabOverdue(item({ exp: "CONCLUIDO" }), CATALOG, TODAY)).toBe(true);
  });
});

describe("productionRowsTotals — três números do card", () => {
  it("soma registros, quantidades e peso (item sem peso entra como 0)", () => {
    expect(
      productionRowsTotals([
        { quantity: 4, unitWeightKg: 1.5 },
        { quantity: 2, unitWeightKg: null },
        { quantity: 1, unitWeightKg: 2 },
      ]),
    ).toEqual({ records: 3, qty: 7, weight: 8 });
  });

  it("recorte vazio zera os três números", () => {
    expect(productionRowsTotals([])).toEqual({ records: 0, qty: 0, weight: 0 });
  });
});
