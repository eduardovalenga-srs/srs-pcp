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

/** Trecho da tabela que CONTÉM o trecho indicado (âncora dentro dela). */
function tableAround(markup: string, anchor: string): string {
  const index = markup.indexOf(anchor);
  expect(index).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<table", index);
  const end = markup.indexOf("</table>", index);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end);
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
    processes: {},
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
    // Sem catálogo: as colunas de processo do editor de itens ficam vazias
    // (a cobertura delas está em romaneio-detail-processes.test.ts).
    processes: [],
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
    // Insumos do preview ao vivo do detalhe: sem estrutura da OF a
    // alocação fica vazia e as linhas vêm do gravado (planned 20).
    allocationItems: [],
    storedMaterials: [
      {
        description: "Chapa aço 3mm",
        unit: "KG",
        quantityPlanned: 20,
        quantityReceived: 18,
        quantityUsed: 15,
      },
    ],
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

describe("detalhe do romaneio — enxuto (conferência e NF saem daqui)", () => {
  it("não tem mais seção de conferência, link da ficha nem contagem", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).not.toContain('href="/romaneio/rom-1/conferencia"');
    expect(markup).not.toContain("Abrir ficha de conferência");
    expect(markup).not.toContain("Itens marcados como conferidos");
    expect(markup).not.toContain("A conferência é feita na ficha");
    expect(markup).not.toContain('aria-label="Conferência"');
    // O aceite continua visível na linha de timestamps da Situação.
    expect(markup).toContain("Criado em");
  });

  it("não tem mais seção de NF nem o botão/dialogo de confirmar", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).not.toContain('aria-label="Notas fiscais"');
    expect(markup).not.toContain('aria-label="romaneio-nf"');
    expect(markup).not.toContain("Confirmar romaneio");
    expect(markup).not.toContain("Para confirmar, falta:");
    expect(markup).not.toContain("Pronto para confirmar");
    // As ações que sobram: Salvar/Excluir (ABERTO) e Cancelar.
    expect(markup).toContain("Salvar");
    expect(markup).toContain("Excluir");
  });

  it("materiais do detalhe são somente leitura (o lançamento é na ficha)", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).toContain("As quantidades são lançadas na ficha de conferência");
    expect(inputBlock(markup, "Quantidade utilizada de Chapa aço 3mm")).toContain("disabled");
    // A coluna "Recebida do cliente" sumiu da tabela de materiais.
    expect(markup).not.toContain("Recebida do cliente");
    expect(markup).not.toContain('aria-label="Quantidade recebida de Chapa aço 3mm"');
  });
});

describe("totalizadores de peso no detalhe (sem listagem por item)", () => {
  it("sem tabela/bloco por item — só o total ao pé de cada tabela", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    // A listagem de peso por item sumiu do detalhe (só existe na ficha).
    expect(markup).not.toContain("Peso dos itens da carga");
    expect(markup).not.toContain("Peso unit. (kg)");
    expect(markup).not.toContain("Peso total (kg)");

    // Totalizador na tabela de matéria-prima…
    const materialsTable = tableAround(markup, "Chapa aço 3mm");
    expect(materialsTable).toContain("Peso total da carga");
    // …e na tabela de itens raiz, na coluna "Peso carga (kg)".
    const itemsTable = tableAround(
      markup,
      'aria-label="Quantidade de Porta 80x200 nesta carga"',
    );
    expect(itemsTable).toContain("Peso total da carga");

    // item-1: 4 × 10 kg = 40 kg nas DUAS tabelas.
    expect(materialsTable).toContain("40 kg");
    expect(itemsTable).toContain("40 kg");
  });

  it("na ficha: a tabela de peso continua intacta", () => {
    const markup = html(createElement(RomaneioConferenceSheet, { view: view(), canEdit: true }));

    expect(markup).toContain("Peso dos itens da carga");
    expect(markup).toContain("Peso total da carga");
    expect(markup).toContain("40 kg");
    // A ficha é o único lugar com a coluna de recebida.
    expect(markup).toContain('aria-label="Quantidade recebida de Chapa aço 3mm"');
    // Linhas com borda preta no papel (mesma marcação das demais tabelas da ficha).
    expect(markup).toContain("print:border-black/40");
  });

  it("soma só os itens incluídos nos dois totalizadores", () => {
    const markup = html(
      createElement(RomaneioDetail, {
        view: view({
          items: [
            orderItem({ orderItemId: "a", quantity: 2, unitWeightKg: 5.5 }),
            orderItem({ orderItemId: "b", description: "Fora da carga", quantity: 0 }),
            orderItem({ orderItemId: "c", quantity: 3, unitWeightKg: null }),
          ],
        }),
        canEditCapability: true,
      }),
    );

    // 2 × 5,5 = 11 (pt-BR); o item fora da carga entra com 0 e o sem
    // peso não entra na soma.
    const materialsTable = tableAround(markup, "Chapa aço 3mm");
    expect(materialsTable).toContain("Peso total da carga");
    expect(materialsTable).toContain("11 kg");

    const itemsTable = tableAround(
      markup,
      'aria-label="Quantidade de Porta 80x200 nesta carga"',
    );
    expect(itemsTable).toContain("Peso total da carga");
    expect(itemsTable).toContain("11 kg");
    // O total é a ÚLTIMA linha da tabela (o totalizador fecha a tabela).
    expect(itemsTable.indexOf("Peso total da carga")).toBeGreaterThan(
      itemsTable.lastIndexOf("Fora da carga"),
    );
  });

  it("carga vazia não totaliza nos materiais; sem peso unitário avisa", () => {
    const empty = html(
      createElement(RomaneioDetail, {
        view: view({
          items: [orderItem({ quantity: 0 }), orderItem({ orderItemId: "item-2", quantity: 0 })],
        }),
        canEditCapability: true,
      }),
    );
    expect(empty).not.toContain("Peso dos itens da carga");
    // Sem itens incluídos a tabela de materiais não tem linha de peso.
    expect(tableAround(empty, "Chapa aço 3mm")).not.toContain("Peso total da carga");

    const noWeight = html(
      createElement(RomaneioDetail, {
        view: view({
          items: [orderItem({ unitWeightKg: null }), orderItem({ orderItemId: "item-2", quantity: 0 })],
        }),
        canEditCapability: true,
      }),
    );
    const materialsTable = tableAround(noWeight, "Chapa aço 3mm");
    expect(materialsTable).toContain("Peso total da carga");
    expect(materialsTable).toContain(">—<");
    expect(noWeight).toContain("Itens sem peso unitário cadastrado.");
    expect(noWeight).not.toContain("Peso dos itens da carga");
  });
});

describe("RomaneioItemsWeightTable — componente usado só na ficha", () => {
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

  it("sem itens incluídos não renderiza", () => {
    const empty = html(
      createElement(RomaneioItemsWeightTable, {
        items: [orderItem({ quantity: 0 }), orderItem({ orderItemId: "item-2", quantity: 0 })],
      }),
    );
    expect(empty).toBe("");
  });
});

describe("total da carga na tabela de materiais (detalhe)", () => {
  it("soma ESTA carga coluna a coluna; a OF inteira fica só na nota", () => {
    const markup = html(
      createElement(RomaneioDetail, {
        view: view({ ofMaterialTotals: { received: 50, used: 40, returned: 10 } }),
        canEditCapability: true,
      }),
    );

    const materialsTable = tableAround(markup, "Chapa aço 3mm");
    // A tabela fecha com o total DESTA carga: 20 previsto · 15
    // utilizada · 3 saldo (18 − 15) — a linha vem ANTES do peso.
    const totalStart = materialsTable.indexOf("Total da carga");
    expect(totalStart).toBeGreaterThanOrEqual(0);
    expect(totalStart).toBeLessThan(materialsTable.indexOf("Peso total da carga"));
    const totalRow = materialsTable.slice(
      totalStart,
      materialsTable.indexOf("</tr>", totalStart),
    );
    expect(totalRow).toContain(">20</td>");
    expect(totalRow).toContain(">15</td>");
    expect(totalRow).toContain(">3</td>");
    // Os números da OF inteira (40 utilizada) NÃO entram na tabela…
    expect(totalRow).not.toContain(">40</td>");
    expect(materialsTable).not.toContain("OF inteira");

    // …continuam na nota abaixo, com a visão de todos os romaneios.
    expect(markup).toContain("OF inteira (todos os romaneios)");
    expect(markup).toContain("utilizada 40");
  });

  it("recalcula o previsto com a estrutura da OF (auto-reload do detalhe)", () => {
    const markup = html(
      createElement(RomaneioDetail, {
        view: view({
          // O campo materials congelado diria 20; o preview local usa a
          // estrutura da OF: 4 ÷ 10 × 5 KG = 2 KG nesta carga.
          allocationItems: [
            {
              orderItemId: "item-1",
              parentItemId: null,
              quantity: 10,
              materials: [{ description: "Chapa aço 3mm", unit: "KG", quantity: 5 }],
            },
          ],
          storedMaterials: [
            {
              description: "Chapa aço 3mm",
              unit: "KG",
              quantityPlanned: 20,
              quantityReceived: 18,
              quantityUsed: 15,
            },
          ],
        }),
        canEditCapability: true,
      }),
    );

    const materialsTable = tableAround(markup, "Chapa aço 3mm");
    // Previsto vem do preview (2 KG) — o gravado (20) não aparece.
    expect(materialsTable).toContain(">2</td>");
    expect(materialsTable).not.toContain(">20</td>");
    // Utilizada e saldo continuam os gravados (15 · 18 − 15 = 3).
    const totalStart = materialsTable.indexOf("Total da carga");
    const totalRow = materialsTable.slice(
      totalStart,
      materialsTable.indexOf("</tr>", totalStart),
    );
    expect(totalRow).toContain(">15</td>");
    expect(totalRow).toContain(">3</td>");
  });
});
