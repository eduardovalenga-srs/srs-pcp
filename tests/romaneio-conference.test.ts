import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioConferenceSheet } from "@/components/romaneio/RomaneioConferenceSheet";
import { RomaneioDetail } from "@/components/romaneio/RomaneioDetail";
import { RomaneioItemsWeightTable } from "@/components/romaneio/RomaneioItemsWeightTable";
import type { RomaneioOrderItem, RomaneioView } from "@/lib/types/romaneio";

vi.mock("next/navigation", () => ({
  usePathname: () => "/romaneio",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: (props: { href: string; className?: string; title?: string; children?: ReactNode }) =>
      h("a", { href: props.href, className: props.className, title: props.title }, props.children),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/romaneio.actions", () => ({
  saveRomaneioConferenceAction: vi.fn(),
  saveRomaneioAction: vi.fn(),
  saveRomaneioNfAction: vi.fn(),
  confirmRomaneioAction: vi.fn(),
  deleteRomaneioAction: vi.fn(),
  cancelRomaneioAction: vi.fn(),
}));
// Diálogos do detalhe (radix) não abrem em SSR — saem nulos.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogDescription: () => null,
  DialogFooter: () => null,
  DialogHeader: () => null,
  DialogTitle: () => null,
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

/** Bloco de um botão pelo texto do rótulo. */
function buttonBlock(markup: string, label: string): string {
  const index = markup.indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<button", index);
  const end = markup.indexOf("</button>", index);
  expect(start).toBeGreaterThanOrEqual(0);
  return markup.slice(start, end + "</button>".length);
}

/** Tag <input> que carrega o aria-label indicado. */
function inputBlock(markup: string, ariaLabel: string): string {
  const needle = `aria-label="${ariaLabel}"`;
  const index = markup.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<input", index);
  const end = markup.indexOf(">", index);
  expect(start).toBeGreaterThanOrEqual(0);
  return markup.slice(start, end + 1);
}

function orderItem(overrides: Partial<RomaneioOrderItem> = {}): RomaneioOrderItem {
  return {
    orderItemId: "item-1",
    family: "PORTA",
    parentItem: null,
    description: "Porta 80x200",
    itemQuantity: 6,
    unitWeightKg: 10,
    shippedQuantity: 0,
    expStatus: "CONCLUIDO",
    quantity: 4,
    conferenceChecked: false,
    ...overrides,
  };
}

function view(overrides: Partial<RomaneioView> = {}): RomaneioView {
  return {
    id: "rom-1",
    number: 42,
    status: "ABERTO",
    orderId: "order-1",
    orderCode: "OF 107482",
    orderType: "OF",
    customerName: "ACME",
    orderDeliveryDate: "2026-10-20",
    orderStatus: "EM_PRODUCAO",
    shipmentDate: "2026-10-25",
    carrier: "Transportadora X",
    vehicle: "ABC1D23",
    notes: null,
    conferenceAcceptedAt: null,
    conferenceAcceptedByName: null,
    conferenceNotes: null,
    emittedAt: null,
    nfNumber: null,
    returnNfNumber: null,
    createdAt: "2026-10-20T09:00:00Z",
    // item-2 fica FORA da carga (quantity 0) — a ficha não o exibe.
    items: [orderItem(), orderItem({ orderItemId: "item-2", quantity: 0, unitWeightKg: null })],
    materials: [
      {
        description: "Chapa aço 3mm",
        unit: "KG",
        quantityPlanned: 20,
        quantityReceived: 18,
        quantityUsed: 15,
        quantityReturned: 3,
      },
    ],
    ofMaterialTotals: { received: 18, used: 15, returned: 3 },
    confirmation: {
      canConfirm: false,
      blockers: ["Conclua a conferência (aceite) antes de confirmar."],
    },
    canEdit: true,
    ...overrides,
  };
}

describe("ficha de conferência como formulário (048)", () => {
  it("em ABERTO exibe checkboxes, inputs de material e os dois botões", () => {
    const markup = html(createElement(RomaneioConferenceSheet, { view: view(), canEdit: true }));

    expect(markup).toContain("Salvar rascunho");
    expect(markup).toContain("Marcar como conferida");
    expect(markup).toContain("Imprimir");

    // Checkbox por item INCLUÍDO (o item fora da carga fica de fora).
    expect(markup.match(/type="checkbox"/g)).toHaveLength(1);

    // Coluna "Conferido" virou recebida/utilizada com os valores salvos.
    expect(markup).toContain('aria-label="Quantidade recebida de Chapa aço 3mm"');
    expect(markup).toContain('aria-label="Quantidade utilizada de Chapa aço 3mm"');
    expect(inputBlock(markup, "Quantidade recebida de Chapa aço 3mm")).toContain('value="18"');
    expect(inputBlock(markup, "Quantidade utilizada de Chapa aço 3mm")).toContain('value="15"');

    // No papel: checkbox vira caixinha com ✔/vazia e a barra some.
    expect(markup).toContain("print:hidden");
    expect(markup).toContain('class="hidden h-4 w-4 border text-center text-[11px] leading-[14px] print:block"');
    expect(markup).toContain("print:bg-transparent");
  });

  it("concluir fica bloqueado enquanto houver item pendente", () => {
    const pending = html(createElement(RomaneioConferenceSheet, { view: view(), canEdit: true }));
    expect(buttonBlock(pending, "Marcar como conferida")).toContain('disabled=""');
    expect(pending).toContain("Faltam 1 item marcado para concluir a conferência.");

    const allChecked = html(
      createElement(RomaneioConferenceSheet, {
        view: view({
          items: [orderItem({ conferenceChecked: true }), orderItem({ orderItemId: "item-2", quantity: 0 })],
        }),
        canEdit: true,
      }),
    );
    expect(buttonBlock(allChecked, "Marcar como conferida")).not.toContain('disabled=""');
    expect(allChecked).not.toContain("Faltam ");
  });

  it("após CONFERIDO vira somente leitura (sem botões de salvar)", () => {
    const markup = html(
      createElement(RomaneioConferenceSheet, {
        view: view({
          status: "CONFERIDO",
          conferenceAcceptedAt: "2026-10-25T10:00:00Z",
          conferenceAcceptedByName: "Gestor",
          conferenceNotes: "Carga conferida com o cliente.",
        }),
        canEdit: true,
      }),
    );

    expect(markup).not.toContain("Salvar rascunho");
    expect(markup).not.toContain("Marcar como conferida");
    expect(markup).toContain("Imprimir");

    // readOnly (não disabled) mantém a cor do texto na impressão.
    expect(inputBlock(markup, "Quantidade recebida de Chapa aço 3mm")).toContain('readOnly=""');
    expect(markup).toContain("Aceite registrado no sistema");
  });

  it("sem capacidade romaneio.edit não mostra os botões de salvar", () => {
    const markup = html(createElement(RomaneioConferenceSheet, { view: view(), canEdit: false }));

    expect(markup).not.toContain("Salvar rascunho");
    expect(markup).not.toContain("Marcar como conferida");
    expect(markup).toContain("Imprimir");
  });
});

describe("detalhe do romaneio — leitura + link para a ficha (048)", () => {
  it("aponta para a ficha, conta os itens marcados e não sinaliza mais", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).toContain('href="/romaneio/rom-1/conferencia"');
    expect(markup).toContain("Abrir ficha de conferência");
    expect(markup).not.toContain("Sinalizar aceite");
    expect(markup).toContain("Itens marcados como conferidos: 0 de 1.");
    expect(markup).toContain(
      "A conferência é feita na ficha: marque os itens, lance a devolução e salve o rascunho",
    );
  });

  it("materiais do detalhe são somente leitura (o lançamento é na ficha)", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).toContain("As quantidades são lançadas na ficha de conferência");
    expect(inputBlock(markup, "Quantidade recebida de Chapa aço 3mm")).toContain("disabled");
    expect(inputBlock(markup, "Quantidade utilizada de Chapa aço 3mm")).toContain("disabled");
  });

  it("mostra a contagem de itens marcados após o aceite", () => {
    const markup = html(
      createElement(RomaneioDetail, {
        view: view({
          status: "CONFERIDO",
          conferenceAcceptedAt: "2026-10-25T10:00:00Z",
          conferenceAcceptedByName: "Gestor",
          items: [orderItem({ conferenceChecked: true }), orderItem({ orderItemId: "item-2", quantity: 0 })],
        }),
        canEditCapability: true,
      }),
    );

    expect(markup).toContain("Itens marcados como conferidos: 1 de 1.");
    expect(markup).toContain("Aceite registrado em");
  });
});

describe("tabela de peso dos itens na devolução (peso dos itens)", () => {
  it("no detalhe: lista qtd, peso unitário e total dentro da seção de devolução", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).toContain("Peso dos itens da carga");
    expect(markup).toContain("Peso unit. (kg)");
    expect(markup).toContain("Peso total (kg)");
    // item-1: 4 × 10 kg = 40 kg.
    expect(markup).toContain("Peso total da carga");
    expect(markup).toContain("40 kg");

    // Wrapper do detalhe: card que some na impressão.
    expect(markup).toContain("print:bg-transparent");
  });

  it("na ficha: a tabela entra na seção de devolução com estilos de impressão", () => {
    const markup = html(createElement(RomaneioConferenceSheet, { view: view(), canEdit: true }));

    expect(markup).toContain("Peso dos itens da carga");
    expect(markup).toContain("Peso total da carga");
    expect(markup).toContain("40 kg");
    // Linhas com borda preta no papel (mesma marcação das demais tabelas da ficha).
    expect(markup).toContain("print:border-black/40");
  });

  it("exclui item fora da carga e soma só os incluídos", () => {
    const markup = html(
      createElement(RomaneioItemsWeightTable, {
        items: [
          orderItem({ orderItemId: "a", quantity: 2, unitWeightKg: 5.5 }),
          orderItem({ orderItemId: "b", description: "Fora da carga", quantity: 0 }),
          orderItem({ orderItemId: "c", quantity: 3, unitWeightKg: null }),
        ],
      }),
    );

    expect(markup).not.toContain("Fora da carga");
    // 2 × 5,5 = 11 (pt-BR); o sem peso sai "—" e não entra no total.
    expect(markup).toContain("11");
    expect(markup).toContain("Peso total da carga");
    expect(markup).toContain("11 kg");
    // thead + 2 itens incluídos + tfoot (o item fora da carga não vira linha).
    expect(markup.match(/<tr/g)).toHaveLength(4);
  });

  it("sem itens incluídos não renderiza; sem peso unitário avisa", () => {
    const empty = html(
      createElement(RomaneioItemsWeightTable, {
        items: [orderItem({ quantity: 0 }), orderItem({ orderItemId: "item-2", quantity: 0 })],
      }),
    );
    expect(empty).toBe("");

    const noWeight = html(
      createElement(RomaneioDetail, {
        view: view({
          items: [orderItem({ unitWeightKg: null }), orderItem({ orderItemId: "item-2", quantity: 0 })],
        }),
        canEditCapability: true,
      }),
    );
    expect(noWeight).toContain("Itens sem peso unitário cadastrado.");
    expect(noWeight).not.toContain("Peso total da carga");
  });
});
