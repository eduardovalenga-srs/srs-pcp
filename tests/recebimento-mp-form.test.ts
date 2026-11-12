import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RecebimentoMpForm,
  canSaveMpReceipt,
  customerComboboxOptions,
  initialMpQuantities,
  markedMpMaterials,
  mpQuantityValue,
  orderComboboxOptions,
} from "@/components/recebimento-mp/RecebimentoMpForm";
import type {
  MpReceiptCustomerOption,
  MpReceiptMaterial,
} from "@/lib/types/mp-receipt";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/mp-receipt.actions", () => ({
  deleteMpReceiptAction: vi.fn(),
  loadMpReceiptOrderAction: vi.fn(),
  saveMpReceiptAction: vi.fn(),
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

/** Material da OF na tela (grão MATÉRIA-PRIMA). */
function material(overrides: Partial<MpReceiptMaterial> = {}): MpReceiptMaterial {
  return {
    materialKey: "TB33.40X3.38::KG",
    description: "TB33.40X3.38",
    unit: "KG",
    totalKg: 20,
    receivedKg: 0,
    balanceKg: 20,
    ...overrides,
  };
}

const CHAPA = material({
  materialKey: "CHAPA 3MM::KG",
  description: "CHAPA 3MM",
  totalKg: 5,
  balanceKg: 5,
});

describe("recebimento de MP — o que entra na nota (059)", () => {
  it("os campos de uma nova nota começam VAZIOS (nada é recebido por padrão)", () => {
    // Regressão: com o campo pré-preenchido com o Saldo, o material
    // que NÃO tinha chegado entrava na nota como recebido por completo
    // (zerava o saldo e liberava a produção sem o material).
    expect(initialMpQuantities()).toEqual({});
  });

  it("material sem valor digitado NÃO entra na nota, mesmo com saldo pendente", () => {
    const materials = [material(), CHAPA];
    // Nenhum campo preenchido — a nota fica vazia.
    expect(markedMpMaterials(materials, {})).toEqual([]);
    expect(markedMpMaterials(materials, { [material().materialKey]: "" })).toEqual([]);
    // Zerado é o mesmo que "não veio": também não entra.
    expect(markedMpMaterials(materials, { [material().materialKey]: "0" })).toEqual([]);
  });

  it("entra na nota SÓ o material digitado", () => {
    const materials = [material(), CHAPA];
    const marked = markedMpMaterials(materials, { [material().materialKey]: "50" });

    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({
      materialKey: "TB33.40X3.38::KG",
      description: "TB33.40X3.38",
      unit: "KG",
      quantityKg: 50,
    });
  });

  it("o valor digitado é o que vale — parcial ou acima do saldo", () => {
    const materials = [material()];

    // Parcial: 50 de 20 pendentes… o app não corrige o clerk.
    expect(markedMpMaterials(materials, { [material().materialKey]: "12,5" })[0]?.quantityKg).toBe(
      12.5,
    );
    // Sobra: acima do saldo também entra como digitado.
    expect(markedMpMaterials(materials, { [material().materialKey]: "25" })[0]?.quantityKg).toBe(25);
  });

  it("o botão Registrar só habilita com ao menos um material preenchido", () => {
    const materials = [material(), CHAPA];
    expect(canSaveMpReceipt(materials, {})).toBe(false);
    expect(canSaveMpReceipt(materials, { [CHAPA.materialKey]: "" })).toBe(false);
    expect(canSaveMpReceipt(materials, { [CHAPA.materialKey]: "0" })).toBe(false);
    expect(canSaveMpReceipt(materials, { [CHAPA.materialKey]: "5" })).toBe(true);
  });
});

describe("recebimento de MP — o campo nasce ZERADO", () => {
  const KEY = "TB33.40X3.38::KG";

  it("mostra 0 enquanto o clerk não digita", () => {
    expect(mpQuantityValue({}, KEY)).toBe("0");
  });

  it("mostra o valor digitado", () => {
    expect(mpQuantityValue({ [KEY]: "25" }, KEY)).toBe("25");
    expect(mpQuantityValue({ [KEY]: "12,5" }, KEY)).toBe("12,5");
  });

  it("campo limpo volta a 0 (nunca fica em branco)", () => {
    expect(mpQuantityValue({ [KEY]: "" }, KEY)).toBe("0");
  });

  it("o 0 do campo não é o saldo da OF", () => {
    // O saldo vive na coluna "Saldo" (e no botão "= saldo"); o campo
    // nasce zerado para o material não vir como recebido por padrão.
    const materials = [material()];
    expect(materials[0]?.balanceKg).toBe(20);
    expect(mpQuantityValue(initialMpQuantities(), KEY)).toBe("0");
    expect(markedMpMaterials(materials, initialMpQuantities())).toEqual([]);
  });
});

describe("recebimento de MP — seletor em cascata", () => {
  const customers: MpReceiptCustomerOption[] = [
    {
      customerName: "Cliente A",
      ofCount: 2,
      ofs: [
        {
          orderId: "of-1",
          code: "OF 100",
          type: "OF",
          deliveryDate: "2026-11-20",
          status: "EM_PRODUCAO",
          pendingMaterials: 3,
          pendingKg: 120.5,
        },
      ],
    },
  ];

  it("lista os clientes com o nº de OFs pendentes", () => {
    const options = customerComboboxOptions(customers);
    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe("Cliente A");
    expect(options[0]?.hint).toContain("2 OFs");
  });

  it("lista as OFs com o saldo pendente (materiais, não itens)", () => {
    const options = orderComboboxOptions(customers[0]?.ofs ?? []);
    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe("of-1");
    expect(options[0]?.badge).toContain("120,5");
  });
});

describe("recebimento de MP — renderização", () => {
  it("monta a tela com o seletor de cliente e OF", () => {
    const markup = html(
      createElement(RecebimentoMpForm, {
        customers: [
          {
            customerName: "Cliente A",
            ofCount: 1,
            ofs: [
              {
                orderId: "of-1",
                code: "OF 100",
                type: "OF",
                deliveryDate: null,
                status: "EM_PRODUCAO",
                pendingMaterials: 2,
                pendingKg: 10,
              },
            ],
          },
        ],
        canEdit: true,
      }),
    );

    expect(markup).toContain("Recebimento de matéria-prima");
    expect(markup).toContain("mp-recebimento-cliente");
    expect(markup).toContain("mp-recebimento-of");
  });
});
