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
import {
  formatMpFreeItemQuantity,
  invalidMpFreeItemMessage,
  markedMpFreeItems,
  newMpFreeItem,
} from "@/components/recebimento-mp/MpFreeItemsEditor";
import type { MpFreeItemDraft } from "@/components/recebimento-mp/MpFreeItemsEditor";
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
    // O saldo vive só na coluna "Saldo"; o campo nasce zerado e o
    // clerk digita quanto recebeu (sem preenchimento automático).
    const materials = [material()];
    expect(materials[0]?.balanceKg).toBe(20);
    expect(mpQuantityValue(initialMpQuantities(), KEY)).toBe("0");
    expect(markedMpMaterials(materials, initialMpQuantities())).toEqual([]);
  });
});

describe("recebimento de MP — material fora da OF (060)", () => {
  function draft(overrides: Partial<MpFreeItemDraft> = {}): MpFreeItemDraft {
    return { ...newMpFreeItem(), ...overrides };
  }

  it("a linha nova nasce vazia e em kg", () => {
    const item = newMpFreeItem();
    expect(item).toMatchObject({ description: "", quantity: "", unit: "KG" });
    expect(item.id).not.toBe(newMpFreeItem().id);
  });

  it("linha em branco não entra na nota", () => {
    expect(markedMpFreeItems([draft()])).toEqual([]);
    expect(invalidMpFreeItemMessage([draft()])).toBeNull();
  });

  it("entra o item com descrição e quantidade (vírgula aceita)", () => {
    expect(
      markedMpFreeItems([draft({ description: "  Chapa 3mm ", unit: "M2", quantity: "1,5" })]),
    ).toEqual([{ description: "Chapa 3mm", unit: "M2", quantity: 1.5 }]);
  });

  it("linha começada e incompleta é barrada com mensagem clara", () => {
    expect(invalidMpFreeItemMessage([draft({ description: "Chapa", quantity: "" })])).toMatch(
      /quantidade/,
    );
    expect(invalidMpFreeItemMessage([draft({ description: " ", quantity: "2" })])).toMatch(
      /matéria-prima/,
    );
  });

  it("não repete a mesma matéria-prima na lista (descrição + UM)", () => {
    const items = [
      draft({ description: "Chapa", unit: "KG", quantity: "1" }),
      draft({ description: " chapa ", unit: "KG", quantity: "2" }),
    ];
    expect(invalidMpFreeItemMessage(items)).toMatch(/repetida/i);
    // Unidade diferente é outro material.
    expect(
      invalidMpFreeItemMessage([
        draft({ description: "Chapa", unit: "KG", quantity: "1" }),
        draft({ description: "Chapa", unit: "M2", quantity: "2" }),
      ]),
    ).toBeNull();
  });

  it("o botão Registrar habilita com SÓ itens fora da OF", () => {
    const materials = [material()];
    expect(canSaveMpReceipt(materials, {}, [])).toBe(false);
    expect(canSaveMpReceipt(materials, {}, [draft()])).toBe(false);
    expect(
      canSaveMpReceipt(materials, {}, [draft({ description: "Chapa", quantity: "2" })]),
    ).toBe(true);
    // Linha começada (ainda incompleta) também habilita: o clique
    // mostra o que falta, em vez de travar sem explicação.
    expect(canSaveMpReceipt(materials, {}, [draft({ description: "Chapa" })])).toBe(true);
  });

  it("mostra a quantidade com o rótulo da unidade", () => {
    expect(formatMpFreeItemQuantity(2.5, "KG")).toBe("2,5 kg");
    expect(formatMpFreeItemQuantity(100, "UN")).toBe("100 un");
    expect(formatMpFreeItemQuantity(1, "M2")).toBe("1 m²");
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
