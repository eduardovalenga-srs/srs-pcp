import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SeqCell } from "@/components/shared/SeqCell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fabrica-1",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("SeqCell", () => {
  it("edita como texto com teclado numérico — SEM spinner de number (038)", () => {
    const markup = html(
      createElement(SeqCell, {
        value: 3,
        canEdit: true,
        label: "OF-107482 — Tampo X",
        onCommit: async () => ({ success: true, message: "ok" }),
      }),
    );
    // type="number" traria as setinhas ▲▼ do spinner; o app usa texto +
    // inputMode numérico (mesmo teclado no celular, sem spinner no desktop).
    expect(markup).toContain('type="text"');
    expect(markup).toContain('inputMode="numeric"');
    expect(markup).not.toContain('type="number"');
    expect(markup).toContain('value="3"');
    expect(markup).toContain('aria-label="Sequência de fabricação de OF-107482 — Tampo X"');
  });

  it("linha sem número abre o campo vazio (limpar = apagar e gravar)", () => {
    const markup = html(
      createElement(SeqCell, {
        value: null,
        canEdit: true,
        label: "OF-107482 — Tampo Y",
        onCommit: async () => ({ success: true, message: "ok" }),
      }),
    );
    expect(markup).toContain('type="text"');
    expect(markup).toContain('value=""');
    expect(markup).not.toContain('type="number"');
  });

  it("sem permissão de edição vira texto corrido (span), sem campo", () => {
    const markup = html(
      createElement(SeqCell, {
        value: 3,
        canEdit: false,
        label: "OF-107482 — Tampo X",
        onCommit: async () => ({ success: true, message: "ok" }),
      }),
    );
    expect(markup).not.toContain("<input");
    expect(markup).toContain(">3</span>");
    expect(markup).toContain('title="Sequência de fabricação de OF-107482 — Tampo X"');
  });

  it("sem permissão exibe travessão quando a linha não tem número", () => {
    const markup = html(
      createElement(SeqCell, {
        value: null,
        canEdit: false,
        label: "OF-107482 — Tampo Y",
        onCommit: async () => ({ success: true, message: "ok" }),
      }),
    );
    expect(markup).toContain("—");
    expect(markup).not.toContain("<input");
  });
});
