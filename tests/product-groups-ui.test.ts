import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductGroupsCatalog } from "@/components/grupos-produtos/ProductGroupsCatalog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/product-groups.actions", () => ({
  saveProductGroupAction: vi.fn(),
}));

describe("ProductGroupsCatalog — lista matricial inline", () => {
  it("mostra descrição, abreviação e botão para adicionar registros sem modal", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductGroupsCatalog, {
        groups: [],
        processes: [],
        canManage: true,
      }),
    );

    expect(markup).toContain(">Família</th>");
    expect(markup).toContain(">Abrv</th>");
    expect(markup).toContain("Adicionar registro");
    expect(markup).not.toContain('role="dialog"');
  });

  it("deixa unidade compacta em kg e o campo de capacidade com largura visual de cinco caracteres", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductGroupsCatalog, {
        groups: [],
        processes: [
          {
            id: "2f42a6aa-8ce2-4da8-9e39-65c9ed197b4a",
            code: "CORTE",
            name: "Corte",
            displayOrder: 1,
            active: true,
            location: "Fábrica 1",
            durationDays: 1,
          },
        ],
        canManage: true,
      }),
    );

    expect(markup).toContain("Un.");
    expect(markup).toContain("Cap.");
    expect(markup).toContain("kg");
    expect(markup).toContain("w-[5ch]");
    expect(markup).not.toContain('maxLength="5"');
  });
});
