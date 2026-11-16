import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductGroupsCatalog, mergeGroupDraft } from "@/components/grupos-produtos/ProductGroupsCatalog";

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

  it("pré-preenche com zero todas as capacidades, inclusive as de novos grupos", () => {
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
          {
            id: "9a0f5b0e-1bb2-4f0f-8f70-6a2d1c5ee0aa",
            code: "SOLDA",
            name: "Solda",
            displayOrder: 2,
            active: true,
            location: "Fábrica 2",
            durationDays: 1,
          },
        ],
        canManage: true,
      }),
    );

    // Um input de capacidade por processo, todos iniciando em 0.
    expect(markup.match(/inputMode="decimal"/g)).toHaveLength(2);
    expect(markup.match(/value="0"/g)).toHaveLength(2);
  });

  it("depois de salvo, mostra ações de editar e excluir e mantém a leitura até editar", () => {
    const process = {
      id: "2f42a6aa-8ce2-4da8-9e39-65c9ed197b4a",
      code: "CORTE",
      name: "Corte",
      displayOrder: 1,
      active: true,
      location: "Fábrica 1" as const,
      durationDays: 1,
    };
    const markup = renderToStaticMarkup(
      createElement(ProductGroupsCatalog, {
        groups: [
          {
            id: 12,
            familyDescription: "Estruturas",
            familyAbbreviation: "EST",
            groupType: "12-EST",
            capacities: [
              {
                id: "capacity-1",
                factory: "Fábrica 1",
                processId: process.id,
                processCode: "CORTE",
                processName: "Corte",
                processDisplayOrder: 1,
                unit: "KG",
                capacity: 250,
              },
            ],
          },
        ],
        processes: [process],
        canManage: true,
      }),
    );

    expect(markup).toContain(">Editar<");
    expect(markup).toContain(">Excluir<");
    // Registro salvo abre em modo leitura; os campos voltam ao editar.
    expect(markup).not.toContain('aria-label="Família"');
    expect(markup).not.toContain('inputMode="decimal"');
    expect(markup).toContain("250 kg");
  });

  it("preserva a mensagem de erro enviada no patch e limpa nas edições normais", () => {
    const draft = { key: "new-group-0", error: "", familyDescription: "", familyAbbreviation: "" };

    expect(mergeGroupDraft(draft, { familyDescription: "Estruturas" })).toMatchObject({
      familyDescription: "Estruturas",
      error: "",
    });

    expect(mergeGroupDraft({ ...draft, error: "erro antigo" }, { error: "Informe a capacidade." })).toMatchObject({
      error: "Informe a capacidade.",
    });

    // Editar um campo depois de uma falha limpa o aviso.
    expect(
      mergeGroupDraft({ ...draft, error: "Informe a capacidade." }, { familyAbbreviation: "EST" }),
    ).toMatchObject({ familyAbbreviation: "EST", error: "" });
  });
});
