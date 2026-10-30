import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RomaneioNewForm,
  canConfirmRomaneio,
  canGenerateRomaneio,
  customerComboboxOptions,
  markedRomaneioItems,
  orderComboboxOptions,
} from "@/components/romaneio/RomaneioNewForm";
import { filterComboboxOptions } from "@/components/shared/combobox";
import type {
  RomaneioCandidate,
  RomaneioCustomerOption,
  RomaneioOrderItem,
} from "@/lib/types/romaneio";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/romaneio.actions", () => ({
  createRomaneioAction: vi.fn(),
  getRomaneioOrderItemsAction: vi.fn(),
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

/** Tag de abertura do <button> que recebe o id indicado. */
function buttonTagById(markup: string, id: string): string {
  const at = markup.indexOf(`id="${id}"`);
  expect(at, `id "${id}" presente no markup`).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<button", at);
  const end = markup.indexOf(">", at);
  return markup.slice(start, end + 1);
}

/** Tag de abertura do <button> que contém o texto indicado. */
function buttonTagByText(markup: string, text: string): string {
  // Pula ocorrências antes de qualquer <button> (ex.: aria-label da seção).
  let at = markup.indexOf(text);
  while (at >= 0) {
    const start = markup.lastIndexOf("<button", at);
    if (start >= 0) {
      return markup.slice(start, markup.indexOf(">", start) + 1);
    }
    at = markup.indexOf(text, at + 1);
  }
  throw new Error(`texto "${text}" dentro de um <button> não encontrado no markup`);
}

function of(overrides: Partial<RomaneioCandidate> = {}): RomaneioCandidate {
  return {
    orderId: "order-1",
    code: "OF 107482",
    type: "OF",
    customerName: "ACME",
    deliveryDate: "2026-10-20",
    status: "PLANEJADO",
    rootQuantity: 6,
    rootWeightKg: 12,
    shippedQuantity: 2,
    hasOpenRomaneio: false,
    openRomaneioId: null,
    ...overrides,
  };
}

function customer(customerName: string | null, ofs: RomaneioCandidate[]): RomaneioCustomerOption {
  return { customerName, ofCount: ofs.length, ofs };
}

function orderItem(overrides: Partial<RomaneioOrderItem> = {}): RomaneioOrderItem {
  return {
    orderItemId: "item-1",
    family: "PORTA",
    parentItem: "P1",
    description: "Porta 80x200",
    itemQuantity: 6,
    unitWeightKg: 2,
    shippedQuantity: 2,
    expStatus: "CONCLUIDO",
    quantity: 0,
    ...overrides,
  };
}

describe("opções dos dropdowns em cascata — /romaneio/novo", () => {
  it("lista os clientes com a contagem de OFs e o bucket sem cliente", () => {
    const options = customerComboboxOptions([
      customer("ACME", [of()]),
      customer(null, [of({ orderId: "order-2" }), of({ orderId: "order-3" })]),
    ]);
    expect(options).toEqual([
      { value: "ACME", label: "ACME", hint: "1 OF" },
      { value: "__sem_cliente__", label: "Cliente não informado", hint: "2 OFs" },
    ]);
  });

  it("lista as OFs do cliente com entrega e selo quando já tem romaneio aberto", () => {
    const options = orderComboboxOptions([
      of(),
      of({
        orderId: "order-2",
        code: "OF 107483",
        deliveryDate: null,
        hasOpenRomaneio: true,
        openRomaneioId: "rom-1",
      }),
    ]);
    expect(options).toEqual([
      { value: "order-1", label: "OF 107482", hint: "Entrega 20/10/2026", badge: undefined },
      { value: "order-2", label: "OF 107483", hint: "Sem data de entrega", badge: "Romaneio aberto" },
    ]);
  });
});

describe("filtro por digitação (digita enquanto digita)", () => {
  const options = customerComboboxOptions([
    customer("Serralheria São Jorge", [of()]),
    customer("ACME", [of({ orderId: "order-2" }), of({ orderId: "order-3" })]),
  ]);

  it("filtra por trecho do rótulo sem diferenciar caixa nem acentos", () => {
    expect(filterComboboxOptions(options, "serral").map((entry) => entry.value)).toEqual([
      "Serralheria São Jorge",
    ]);
    expect(filterComboboxOptions(options, "acme").map((entry) => entry.value)).toEqual(["ACME"]);
    expect(filterComboboxOptions(options, "Jorge").map((entry) => entry.value)).toEqual([
      "Serralheria São Jorge",
    ]);
  });

  it("busca também pelo detalhe (hint) e devolve tudo com filtro vazio", () => {
    expect(filterComboboxOptions(options, "2 ofs").map((entry) => entry.value)).toEqual(["ACME"]);
    expect(filterComboboxOptions(options, "1 of").map((entry) => entry.value)).toEqual([
      "Serralheria São Jorge",
    ]);
    expect(filterComboboxOptions(options, "   ")).toHaveLength(2);
    expect(filterComboboxOptions(options, "nada aqui")).toEqual([]);
  });
});

describe("gate do botão Listar itens", () => {
  it("exige OF escolhida", () => {
    expect(canGenerateRomaneio(null, "2026-10-30")).toBe(false);
  });

  it("sem romaneio aberto, exige data de saída válida (YYYY-MM-DD)", () => {
    expect(canGenerateRomaneio(of(), "")).toBe(false);
    expect(canGenerateRomaneio(of(), "30/10/2026")).toBe(false);
    expect(canGenerateRomaneio(of(), "2026-02-30")).toBe(false);
    expect(canGenerateRomaneio(of(), "2026-10-30")).toBe(true);
  });

  it("com romaneio em montagem dispensa a data (o rascunho já existe)", () => {
    expect(canGenerateRomaneio(of({ hasOpenRomaneio: true, openRomaneioId: "rom-1" }), "")).toBe(
      true,
    );
  });
});

describe("itens marcados da remessa", () => {
  const items = [
    orderItem(),
    orderItem({ orderItemId: "item-2", description: "Tela 2x3", quantity: 0 }),
  ];

  it("só leva itens com quantidade > 0, convertendo vírgula decimal", () => {
    expect(
      markedRomaneioItems(items, { "item-1": "4", "item-2": "2,5" }),
    ).toEqual([
      { orderItemId: "item-1", quantity: 4 },
      { orderItemId: "item-2", quantity: 2.5 },
    ]);
  });

  it("ignora vazio, zero, texto inválido e negativos", () => {
    expect(
      markedRomaneioItems(items, { "item-1": "", "item-2": "0" }),
    ).toEqual([]);
    expect(
      markedRomaneioItems(items, { "item-1": "abc", "item-2": "-3" }),
    ).toEqual([]);
  });

  it("canConfirmRomaneio espelha a marcação de pelo menos um item", () => {
    expect(canConfirmRomaneio(items, {})).toBe(false);
    expect(canConfirmRomaneio(items, { "item-1": "0" })).toBe(false);
    expect(canConfirmRomaneio(items, { "item-1": "4" })).toBe(true);
  });
});

describe("render inicial do formulário — /romaneio/novo", () => {
  const customers = [customer("ACME", [of()])];

  it("renderiza os três campos com o botão desabilitado sem seleção", () => {
    const markup = html(createElement(RomaneioNewForm, { customers }));

    expect(markup).toContain('id="romaneio-novo-cliente"');
    expect(markup).toContain('id="romaneio-novo-of"');
    expect(markup).toContain('id="romaneio-novo-saida"');
    expect(markup).toContain('for="romaneio-novo-saida"');
    expect(markup).toContain("Selecione o cliente…");
    expect(markup).toContain("Escolha primeiro o cliente…");
    expect(markup).toContain("Liste os itens da OF e marque as quantidades desta remessa.");
    // Sem cliente + OF + data, o botão nasce desabilitado.
    expect(buttonTagByText(markup, "Listar itens")).toContain('disabled=""');
  });

  it("o seletor de cliente nasce ativo e o de OF desabilitado", () => {
    const markup = html(createElement(RomaneioNewForm, { customers }));
    expect(buttonTagById(markup, "romaneio-novo-cliente")).not.toContain('disabled=""');
    expect(buttonTagById(markup, "romaneio-novo-of")).toContain('disabled=""');
  });

  it("sem clientes disponíveis, os dois seletores nascem desabilitados", () => {
    const markup = html(createElement(RomaneioNewForm, { customers: [] }));
    expect(markup).toContain("Selecione o cliente…");
    expect(buttonTagById(markup, "romaneio-novo-cliente")).toContain('disabled=""');
    expect(buttonTagById(markup, "romaneio-novo-of")).toContain('disabled=""');
    expect(buttonTagByText(markup, "Listar itens")).toContain('disabled=""');
  });
});
