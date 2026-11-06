import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioConferenceSheet } from "@/components/romaneio/RomaneioConferenceSheet";
import { RomaneioDetail } from "@/components/romaneio/RomaneioDetail";
import type { RomaneioOrderItem, RomaneioView } from "@/lib/types/romaneio";
import { romaneioConferenceSchema } from "@/lib/validators/romaneio.schema";

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
    // Peso unitário × qtd não manda mais: o peso por item vem dos
    // materiais em KG alocados (fixture: 15 KG para este item).
    loadWeightKg: 15,
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
    // A UTILIZADA é derivada dos itens: com a estrutura abaixo o
    // preview do detalhe fecha nos MESMOS números do gravado.
    materials: [
      {
        description: "Chapa aço 3mm",
        unit: "KG",
        quantityPlanned: 15,
        quantityReceived: 18,
        quantityUsed: 15,
        quantityReturned: 3,
      },
    ],
    ofMaterialTotals: { received: 18, used: 15, returned: 3 },
    // Insumos do preview ao vivo do detalhe: item-1 é RAIZ da OF (qtd 4,
    // mesma da carga → razão 1) com 15 KG de material — o alocado fecha
    // em 15 e a recebida gravada (18) continua acima (saldo 3).
    allocationItems: [
      {
        orderItemId: "item-1",
        parentItemId: null,
        quantity: 4,
        materials: [{ description: "Chapa aço 3mm", unit: "KG", quantity: 15 }],
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

    // Só a RECEBIDA é input (valor gravado); a utilizada não vira
    // coluna na ficha — o que aparece é o Peso (kg) derivado dela
    // (fixture: 15 KG) e o peso por item na tabela de itens.
    expect(markup).toContain('aria-label="Quantidade recebida de Chapa aço 3mm"');
    expect(inputBlock(markup, "Quantidade recebida de Chapa aço 3mm")).toContain('value="18"');
    expect(markup).not.toContain('aria-label="Quantidade utilizada de Chapa aço 3mm"');
    expect(markup).toContain(">15</td>");
    // As colunas antigas da ficha (Previsto/Utilizada) saíram do espelho.
    expect(markup).not.toContain("Previsto");
    expect(markup).not.toContain("Utilizada");

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
    // As ações que sobram: Salvar/Cancelar/Excluir (ABERTO) e o
    // cancelamento de status (CONFERIDO/CONFIRMADO).
    expect(markup).toContain("Salvar");
    expect(markup).toContain("Excluir");
  });

  it("em edição são exatamente três botões: Salvar, Cancelar e Excluir", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    const start = markup.indexOf('aria-label="Ações do romaneio"');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = markup.indexOf("</section>", start);
    const actions = markup.slice(start, end);

    expect(actions).toContain("Salvar");
    expect(actions).toContain("Cancelar"); // descarta as edições locais
    expect(actions).toContain("Excluir");
    expect(actions.match(/<button/g)).toHaveLength(3);

    // Em ABERTO não entra o cancelamento de STATUS (ciclo de vida) —
    // nunca há dois "Cancelar" na mesma tela.
    expect(markup).not.toContain("Cancelar romaneio");
  });

  it("materiais do detalhe são somente leitura (o lançamento é na ficha)", () => {
    const markup = html(
      createElement(RomaneioDetail, { view: view(), canEditCapability: true }),
    );

    expect(markup).toContain("As quantidades são lançadas na ficha de conferência");
    // Nenhum input de material no detalhe — a utilizada é texto derivado.
    expect(markup).not.toContain('aria-label="Quantidade utilizada de Chapa aço 3mm"');
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

    // O peso vem dos MATERIAIS em KG da carga (fixture: 15 KG) nas
    // DUAS tabelas — o antigo 4 × 10 kg (peso unitário) ficou para trás.
    expect(materialsTable).toContain("15 kg");
    expect(itemsTable).toContain("15 kg");
  });

  it("na ficha: as listas espelham o detalhe (sem a tabela de peso por item)", () => {
    const markup = html(createElement(RomaneioConferenceSheet, { view: view(), canEdit: true }));

    // A listagem de peso POR ITEM (RomaneioItemsWeightTable, removida)
    // não existe mais em lugar nenhum — nem no detalhe nem na ficha.
    expect(markup).not.toContain("Peso dos itens da carga");

    // Itens: MESMAS colunas do detalhe, sem as de processo, + o ✔ da ficha.
    const itemsTable = tableAround(markup, 'aria-label="Marcar como conferido: Porta 80x200"');
    expect(itemsTable).toContain(">Família<");
    expect(itemsTable).toContain(">Item pai<");
    expect(itemsTable).toContain(">Descrição<");
    expect(itemsTable).toContain(">Qtd OF<");
    expect(itemsTable).toContain(">Já expedida<");
    expect(itemsTable).toContain(">Pendência<");
    expect(itemsTable).toContain(">Nesta carga<");
    expect(itemsTable).toContain(">Peso carga (kg)<");
    expect(itemsTable).toContain("15"); // peso por item da fixture

    // Devolução: Material | Unidade | Peso (kg) | RECEBIDA + total ao pé.
    const materialsTable = tableAround(markup, "Chapa aço 3mm");
    expect(materialsTable).toContain(">Material<");
    expect(materialsTable).toContain(">Unidade<");
    expect(materialsTable).toContain(">Peso (kg)<");
    expect(materialsTable).toContain(">Recebida<");
    expect(materialsTable).not.toContain(">Previsto<");
    expect(materialsTable).not.toContain(">Utilizada<");
    expect(materialsTable).toContain("Peso total da carga");
    // Σ da utilizada em KG da ficha (fixture: 15 KG) — fecha com a
    // tabela de itens, o cabeçalho e o detalhe.
    expect(materialsTable).toContain("15 kg");
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
          // Estrutura da OF para ESTES itens: só "a" tem material em
          // peso (11 KG alocados → 11 kg); "c" só tem material em UN.
          allocationItems: [
            {
              orderItemId: "a",
              parentItemId: null,
              quantity: 2,
              materials: [{ description: "Chapa aço 3mm", unit: "KG", quantity: 11 }],
            },
            {
              orderItemId: "c",
              parentItemId: null,
              quantity: 3,
              materials: [{ description: "Parafuso M8", unit: "UN", quantity: 30 }],
            },
          ],
        }),
        canEditCapability: true,
      }),
    );

    // O peso da carga é a UTILIZADA em KG do item "a" (11 kg) — o item
    // fora da carga entra com 0 e o sem material em peso fica "—".
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

  it("carga vazia totaliza 0 kg; sem nenhuma fonte de peso tudo sai —", () => {
    const empty = html(
      createElement(RomaneioDetail, {
        view: view({
          items: [orderItem({ quantity: 0 }), orderItem({ orderItemId: "item-2", quantity: 0 })],
        }),
        canEditCapability: true,
      }),
    );
    expect(empty).not.toContain("Peso dos itens da carga");
    // Carga sem itens: a linha gravada vira órfã (utilizada 0) e o
    // peso da carga fecha em 0 kg — a tabela continua totalizando.
    const emptyMaterials = tableAround(empty, "Chapa aço 3mm");
    expect(emptyMaterials).toContain("Peso total da carga");
    expect(emptyMaterials).toContain("0 kg");

    // Nada de material em peso E nada de peso unitário: sem fonte
    // nenhuma, o total da carga sai "—".
    const noWeightView = view({
      items: [
        orderItem({ unitWeightKg: null, loadWeightKg: null }),
        orderItem({ orderItemId: "item-2", quantity: 0, unitWeightKg: null }),
      ],
      allocationItems: [
        {
          orderItemId: "item-1",
          parentItemId: null,
          quantity: 4,
          materials: [{ description: "Parafuso M8", unit: "UN", quantity: 30 }],
        },
      ],
      storedMaterials: [
        {
          description: "Parafuso M8",
          unit: "UN",
          quantityPlanned: 30,
          quantityReceived: 30,
          quantityUsed: 30,
        },
      ],
      materials: [
        {
          description: "Parafuso M8",
          unit: "UN",
          quantityPlanned: 30,
          quantityReceived: 30,
          quantityUsed: 30,
          quantityReturned: 0,
        },
      ],
    });
    const noWeight = html(
      createElement(RomaneioDetail, { view: noWeightView, canEditCapability: true }),
    );
    const materialsTable = tableAround(noWeight, "Parafuso M8");
    expect(materialsTable).toContain("Peso total da carga");
    expect(materialsTable).toContain(">—<");
    expect(noWeight).not.toContain("Peso dos itens da carga");

    // Sem fonte de peso a ficha espelha o detalhe: total ao pé "—".
    const noWeightSheet = html(
      createElement(RomaneioConferenceSheet, { view: noWeightView, canEdit: true }),
    );
    expect(noWeightSheet).not.toContain("Peso dos itens da carga");
    const sheetMaterials = tableAround(noWeightSheet, "Parafuso M8");
    expect(sheetMaterials).toContain("Peso total da carga");
    expect(sheetMaterials).toContain(">—<");
  });
});

describe("pé da tabela de materiais (detalhe)", () => {
  it("sem a linha “Total da carga” zerada — só o peso total ao pé; OF inteira fica na nota", () => {
    const markup = html(
      createElement(RomaneioDetail, {
        view: view({ ofMaterialTotals: { received: 50, used: 40, returned: 10 } }),
        canEditCapability: true,
      }),
    );

    const materialsTable = tableAround(markup, "Chapa aço 3mm");

    // A linha "Total da carga" (saldo somado, quase sempre zerada) saiu
    // — do desktop e do mobile — e sobrou UMA única linha de total.
    expect(materialsTable).not.toContain("Total da carga");
    expect(markup).not.toContain("Total da carga");
    expect(materialsTable.match(/Peso total da carga/g)).toHaveLength(1);
    expect(materialsTable).toContain("15 kg");

    // Cada linha traz o PESO INDIVIDUAL (a utilizada em KG = 15, a
    // mesma coluna de antes) — previsto, utilizada e saldo a devolver
    // não são mais colunas.
    expect(materialsTable).toContain("Peso (kg)");
    expect(materialsTable).toContain(">15</td>");
    expect(materialsTable).not.toContain("Saldo a devolver");
    expect(materialsTable).not.toContain("Previsto (carga)");
    expect(materialsTable).not.toContain("Utilizada na produção");

    // Os números da OF inteira (40 utilizada) NÃO entram na tabela…
    expect(materialsTable).not.toContain(">40</td>");
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
    // Peso individual = a utilizada já em kg (2) — o gravado (20) não
    // aparece; saldo e previsto não são mais colunas. Tudo recalculado
    // ao vivo, sem salvar.
    expect(materialsTable).toContain(">2</td>");
    expect(materialsTable).not.toContain(">20</td>");
    expect(materialsTable).not.toContain("Saldo a devolver");
    expect(materialsTable).not.toContain("Previsto (carga)");
    expect(materialsTable).not.toContain("Utilizada na produção");
    // ÚNICA linha ao pé: o peso total da carga fecha nos mesmos 2 kg.
    expect(materialsTable).toContain("2 kg");
    expect(materialsTable.match(/Peso total da carga/g)).toHaveLength(1);
  });
});

describe("romaneioConferenceSchema — payload da ficha (regressão do salvamento)", () => {
  it("materiais SEM quantityPlanned passam: chave ausente vira null", () => {
    // A ficha envia description/unit/received/used — sem quantityPlanned.
    // No zod v4 uma união com z.undefined() NÃO opcionaliza a chave e o
    // salvamento morria com "Quantidade planejada: valor inválido
    // (esperado nonoptional)" (corrigido em common.ts: .optional() antes
    // do .transform()).
    const parsed = romaneioConferenceSchema.safeParse({
      romaneioId: "rom-1",
      notes: null,
      checkedItemIds: ["item-1"],
      materials: [
        { description: "Chapa aço 3mm", unit: "KG", quantityReceived: 18, quantityUsed: 15 },
      ],
      sign: false,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.materials[0]!.quantityPlanned).toBeNull();
  });

  it("ainda valida os limites das quantidades informadas", () => {
    const parsed = romaneioConferenceSchema.safeParse({
      romaneioId: "rom-1",
      notes: null,
      checkedItemIds: ["item-1"],
      materials: [
        { description: "Chapa aço 3mm", unit: "KG", quantityReceived: "10,5", quantityUsed: 12 },
      ],
      sign: false,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe(
      "A quantidade utilizada não pode exceder a recebida",
    );
  });
});
