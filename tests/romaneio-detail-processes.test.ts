import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioItemsEditor } from "@/components/romaneio/RomaneioItemsEditor";
import type { RomaneioOrderItem } from "@/lib/types/romaneio";
import type { ProcessDefinition } from "@/lib/types/production";

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

/** Tabela do desktop (o wrapper esconde no mobile, o markup continua lá). */
function tableMarkup(markup: string): string {
  const start = markup.indexOf("<table");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = markup.indexOf("</table>", start);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end + "</table>".length);
}

/** Lista mobile de cards (lg:hidden). */
function mobileMarkup(markup: string): string {
  const start = markup.indexOf('<ul class="space-y-2 lg:hidden"');
  expect(start).toBeGreaterThanOrEqual(0);
  return markup.slice(start);
}

/**
 * Catálogo parcial para as colunas do detalhe (049): inclui a cadeia
 * F1 (LASER — que NÃO abre coluna), os códigos excluídos (MP e KIT) e
 * um processo inativo (também fica de fora). Abrem coluna só
 * SOLDA, ACAB e EXP — na ordem do catálogo.
 */
const PROCESSES: ProcessDefinition[] = [
  { id: "p-mp", code: "MP", name: "Matéria-prima", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "p-laser", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "p-solda", code: "SOLDA", name: "SOLDA", displayOrder: 100, active: true, location: null, durationDays: 1 },
  { id: "p-acab", code: "ACAB", name: "ACAB", displayOrder: 110, active: true, location: null, durationDays: 1 },
  { id: "p-quality", code: "QUALITY", name: "QUALITY", displayOrder: 120, active: false, location: null, durationDays: 1 },
  { id: "p-exp", code: "EXP", name: "EXPEDIÇÃO", displayOrder: 130, active: true, location: null, durationDays: 1 },
  { id: "p-kit", code: "KIT", name: "KIT", displayOrder: 80, active: true, location: null, durationDays: 1 },
];

function item(overrides: Partial<RomaneioOrderItem> = {}): RomaneioOrderItem {
  return {
    orderItemId: "item-1",
    family: "PORTA",
    parentItem: "P1",
    description: "Porta 80x200",
    itemQuantity: 6,
    unitWeightKg: 2,
    shippedQuantity: 2,
    expStatus: "CONCLUIDO",
    processes: { SOLDA: "CONCLUIDO", ACAB: "NAO_INICIADO", EXP: "NAO_APLICAVEL" },
    quantity: 4,
    conferenceChecked: false,
    // Peso da carga derivado dos materiais (fixture coerente: 2 × 4).
    loadWeightKg: 8,
    ...overrides,
  };
}

function renderEditor(items: RomaneioOrderItem[], processes = PROCESSES): string {
  return html(
    createElement(RomaneioItemsEditor, {
      items,
      processes,
      canEdit: true,
      // Peso fora do escopo destes testes (só colunas de processo).
      weightKg: null,
      quantities: Object.fromEntries(items.map((entry) => [entry.orderItemId, String(entry.quantity)])),
      onQuantityChange: () => undefined,
    }),
  );
}

describe("colunas de processo na lista de itens do detalhe (049)", () => {
  it("abre coluna por processo ativo fora da cadeia F1, sem MP e sem KIT", () => {
    const table = tableMarkup(renderEditor([item()]));

    // Entra: SOLDA, ACAB e EXP (ativos, fora da cadeia F1)…
    expect(table).toContain(">SOLDA<");
    expect(table).toContain(">ACAB<");
    expect(table).toContain(">EXP<");
    // Sai: MP e KIT (fora da carga), cadeia F1 (LASER) e inativo (QUALITY).
    expect(table).not.toContain(">MP<");
    expect(table).not.toContain(">KIT<");
    expect(table).not.toContain(">LASER<");
    expect(table).not.toContain(">QUALITY<");
    // A coluna EXP antiga virou conjunto — não fica uma coluna solta "EXP" dupla.
    expect(table.match(/>EXP</g)?.length).toBe(1);
  });

  it("célula mostra só o símbolo da situação do ITEM; sem linha = “—”", () => {
    const table = tableMarkup(renderEditor([item()]));

    expect(table).toContain('aria-label="SOLDA: Concluído"');
    expect(table).toContain(">✓<");
    expect(table).toContain('aria-label="ACAB: Não iniciado"');
    expect(table).toContain(">○<");
    expect(table).toContain('aria-label="EXPEDIÇÃO: Não aplicável"');
    expect(table).toContain(">—<");
  });

  it("cada item carrega a SUA situação (coluna por item, não agregada)", () => {
    const table = tableMarkup(
      renderEditor([
        item(),
        item({
          orderItemId: "item-2",
          processes: { SOLDA: "NAO_INICIADO", ACAB: "CONCLUIDO" }, // sem EXP
        }),
      ]),
    );

    const first = table.indexOf('aria-label="SOLDA: Concluído"');
    const second = table.indexOf('aria-label="SOLDA: Não iniciado"');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    // Item 2 não tem linha de EXP → célula "—".
    expect(table).toContain('aria-label="EXPEDIÇÃO: não aplicável a este item"');
  });

  it("catálogo vazio não monta coluna de processo", () => {
    const table = tableMarkup(renderEditor([item()], []));
    expect(table).not.toContain('aria-label="SOLDA: Concluído"');
    expect(table).not.toContain(">SOLDA<");
    // As colunas clássicas continuam intactas.
    expect(table).toContain(">Qtd OF<");
    expect(table).toContain(">Nesta carga<");
  });
});

describe("mobile do detalhe — linha compacta de processos por item", () => {
  it("exibe símbolo + código de cada processo com rótulo para leitor de tela", () => {
    const mobile = mobileMarkup(renderEditor([item()]));

    expect(mobile).toContain('aria-label="Processos do item"');
    expect(mobile).toContain(">✓<");
    expect(mobile).toContain(">○<");
    expect(mobile).toContain(">—<");
    expect(mobile).toContain(">SOLDA<");
    expect(mobile).toContain(">ACAB<");
    expect(mobile).toContain(">EXP<");
    expect(mobile).toContain("SOLDA: Concluído");
    expect(mobile).toContain("ACAB: Não iniciado");
    // MP/KIT/LASER/QUALITY ficam de fora também no mobile.
    expect(mobile).not.toContain(">MP<");
    expect(mobile).not.toContain(">KIT<");
    expect(mobile).not.toContain(">LASER<");
    expect(mobile).not.toContain(">QUALITY<");
  });
});
