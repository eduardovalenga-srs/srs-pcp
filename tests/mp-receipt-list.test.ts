import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RecebimentoMpList } from "@/components/recebimento-mp/RecebimentoMpList";
import type { MpReceiptListEntry } from "@/lib/types/mp-receipt";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/mp-receipt.actions", () => ({
  deleteMpReceiptAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const entries: MpReceiptListEntry[] = [
  {
    id: "receipt-1",
    number: 12,
    entryNumber: "NF-123",
    entryDate: "2026-11-12",
    userName: "Maria",
    orderCode: "OF-100",
    customerName: "Cliente A",
    materials: [
      {
        materialKey: "TUBO::KG",
        description: "TUBO",
        unit: "KG",
        quantityKg: 12.5,
      },
      {
        materialKey: "CHAPA::KG",
        description: "CHAPA",
        unit: "KG",
        quantityKg: 4,
      },
    ],
  },
  {
    id: "receipt-2",
    number: 11,
    entryNumber: "",
    entryDate: null,
    userName: null,
    orderCode: null,
    customerName: null,
    materials: [],
  },
];

describe("lista geral de recebimentos de MP", () => {
  it("exibe as colunas solicitadas e os recebimentos cadastrados", () => {
    const markup = html(createElement(RecebimentoMpList, { entries, canEdit: true }));

    expect(markup).toContain("Recebimentos cadastrados");
    expect(markup).toContain("<th");
    expect(markup).toContain("OF");
    expect(markup).toContain("Cliente");
    expect(markup).toContain("Nº");
    expect(markup).toContain("Data");
    expect(markup).toContain("Usuário");
    expect(markup).toContain("Matérias-primas (kg)");
    expect(markup).toContain("NF-123");
    expect(markup).toContain("OF-100");
    expect(markup).toContain("Cliente A");
    expect(markup).toContain("12/11/2026");
    expect(markup).toContain("Maria");
    expect(markup).toContain("TUBO: 12,5 kg");
    expect(markup).toContain("CHAPA: 4 kg");
    // Sem número de nota informado, usa o número interno do recebimento.
    expect(markup).toContain(">11</td>");
    expect(markup).toContain(`/recebimento-mp/${entries[0]?.id}`);
    expect(markup).toContain("Consultar");
    expect(markup).toContain("Excluir nota de entrada NF-123");
  });

  it("mostra uma mensagem quando ainda não há recebimentos", () => {
    const markup = html(createElement(RecebimentoMpList, { entries: [], canEdit: false }));

    expect(markup).toContain("Nenhum recebimento cadastrado");
    expect(markup).toContain("Os recebimentos registrados aparecerão nesta lista.");
  });

  it("não exibe a ação de excluir para perfis somente de consulta", () => {
    const markup = html(createElement(RecebimentoMpList, { entries: [entries[0]!], canEdit: false }));

    expect(markup).toContain("Consultar");
    expect(markup).not.toContain("Excluir nota de entrada");
  });
});
