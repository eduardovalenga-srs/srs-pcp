import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RomaneioEmissionDialog,
  RomaneioEmissionStatus,
} from "@/components/romaneio/RomaneioEmissionDialog";
import type { RomaneioSummary } from "@/lib/types/romaneio";

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
  getRomaneioEmissionAction: vi.fn(),
  saveRomaneioNfAction: vi.fn(),
  confirmRomaneioAction: vi.fn(),
}));
// Diálogo (radix) não abre em SSR — a estrutura interna sai nula.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogDescription: ({ children }: { children?: ReactNode }) =>
    createElement("p", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function summary(overrides: Partial<RomaneioSummary> = {}): RomaneioSummary {
  return {
    id: "rom-1",
    number: 42,
    orderId: "order-1",
    orderCode: "OF 107482",
    customerName: "ACME",
    orderDeliveryDate: "2026-10-20",
    status: "CONFERIDO",
    shipmentDate: "2026-10-25",
    carrier: null,
    weightTotal: 12,
    nfNumber: null,
    returnNfNumber: null,
    pendingReturn: false,
    conferenceAcceptedAt: "2026-10-25T10:00:00Z",
    emittedAt: null,
    createdAt: "2026-10-20T09:00:00Z",
    processes: {},
    ...overrides,
  };
}

/** Tag <input> que carrega o id indicado. */
function inputById(markup: string, id: string): string {
  const needle = `id="${id}"`;
  const index = markup.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<input", index);
  const end = markup.indexOf(">", index);
  expect(start).toBeGreaterThanOrEqual(0);
  return markup.slice(start, end + 1);
}

describe("painel de pré-requisitos da emissão", () => {
  it("carregando exibe o aviso de verificação", () => {
    const markup = html(
      createElement(RomaneioEmissionStatus, {
        isEmit: true,
        loading: true,
        loadError: null,
        blockers: [],
      }),
    );

    expect(markup).toContain("Verificando pré-requisitos da emissão…");
    expect(markup).not.toContain("Para emitir, falta:");
  });

  it("lista os bloqueios em “Para emitir, falta:”", () => {
    const markup = html(
      createElement(RomaneioEmissionStatus, {
        isEmit: true,
        loading: false,
        loadError: null,
        blockers: [
          "Conclua a conferência (aceite) antes de confirmar.",
          "Registre o número da NF de saída.",
        ],
      }),
    );

    expect(markup).toContain("Para emitir, falta:");
    expect(markup).toContain("Conclua a conferência (aceite) antes de confirmar.");
    expect(markup).toContain("Registre o número da NF de saída.");
    expect(markup).not.toContain("Pronto para emitir");
  });

  it("sem bloqueios sinaliza que está pronto; com erro mostra a mensagem", () => {
    const ok = html(
      createElement(RomaneioEmissionStatus, {
        isEmit: true,
        loading: false,
        loadError: null,
        blockers: [],
      }),
    );
    expect(ok).toContain("Pronto para emitir — todos os pré-requisitos atendidos.");

    const erro = html(
      createElement(RomaneioEmissionStatus, {
        isEmit: true,
        loading: false,
        loadError: "Romaneio não encontrado.",
        blockers: [],
      }),
    );
    expect(erro).toContain("Romaneio não encontrado.");
    expect(erro).not.toContain("Pronto para emitir");
  });

  it("no modo edição (sem busca) o painel fica invisível", () => {
    const markup = html(
      createElement(RomaneioEmissionStatus, {
        isEmit: false,
        loading: false,
        loadError: null,
        blockers: [],
      }),
    );
    expect(markup).toBe("");
  });
});

describe("diálogo de emissão de NF (lista /romaneio)", () => {
  it("em emit: título, busca de pré-requisitos e NF de saída obrigatória", () => {
    const markup = html(
      createElement(RomaneioEmissionDialog, {
        romaneio: summary(),
        mode: "emit",
        onOpenChange: vi.fn(),
      }),
    );

    expect(markup).toContain("Emitir NF — Romaneio nº 42");
    expect(markup).toContain("Verificando pré-requisitos da emissão…");
    // Enquanto a busca não termina, o botão fica travado.
    expect(inputById(markup, "romaneio-emit-nf")).toContain('placeholder="Obrigatória para emitir"');
    expect(markup).toContain(">Emitir<");
    expect(markup.match(/<button/g)!.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('disabled=""');
    // A devolução é opcional e vem vazia.
    expect(inputById(markup, "romaneio-emit-nf-dev")).toContain(
      'placeholder="Opcional — preenche quando o material voltar"',
    );
  });

  it("em edit: só ajusta os números, já preenchidos, e habilita o salvar", () => {
    const markup = html(
      createElement(RomaneioEmissionDialog, {
        romaneio: summary({
          status: "CONFIRMADO",
          nfNumber: "12345",
          returnNfNumber: "999",
          emittedAt: "2026-10-26T12:00:00Z",
        }),
        mode: "edit",
        onOpenChange: vi.fn(),
      }),
    );

    expect(markup).toContain("Notas fiscais — Romaneio nº 42");
    // Sem busca de pré-requisitos nem aviso de emissão.
    expect(markup).not.toContain("Verificando pré-requisitos");
    expect(markup).not.toContain("Para emitir, falta:");
    expect(inputById(markup, "romaneio-emit-nf")).toContain('value="12345"');
    expect(inputById(markup, "romaneio-emit-nf-dev")).toContain('value="999"');
    // Pronto para salvar (nenhum gate no modo edição).
    expect(markup).toContain(">Salvar<");
    expect(markup).not.toContain('disabled=""');
  });
});
