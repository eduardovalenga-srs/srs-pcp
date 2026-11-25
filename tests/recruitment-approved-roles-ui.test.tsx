import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/actions/recruitment.actions", () => ({
  createRecruitmentApprovedRoleAction: vi.fn(),
  createRecruitmentCustomerAction: vi.fn(),
  deleteRecruitmentApprovedRoleAction: vi.fn(),
  setRecruitmentApprovedRoleActiveAction: vi.fn(),
  updateRecruitmentApprovedRoleAction: vi.fn(),
}));

import { RecruitmentApprovedRolesManager } from "@/components/rh/RecruitmentApprovedRolesManager";

describe("RecruitmentApprovedRolesManager", () => {
  it("mostra ações de editar e excluir em cada cargo", () => {
    const markup = renderToStaticMarkup(
      createElement(RecruitmentApprovedRolesManager, {
        data: {
          clients: [{ id: "client-1", name: "Brafer", active: true }],
          roles: [{
            id: "role-1",
            client_id: "client-1",
            client_name: "Brafer",
            name: "Soldador",
            active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            created_by: null,
            updated_by: null,
          }],
        },
        canManage: true,
      }),
    );

    expect(markup).toContain("Editar");
    expect(markup).toContain("Excluir");
    expect(markup).toContain('aria-label="Editar cargo Soldador"');
    expect(markup).toContain('aria-label="Excluir cargo Soldador"');
  });

  it("filtra por cliente e oculta ações quando é somente leitura", () => {
    const markup = renderToStaticMarkup(
      createElement(RecruitmentApprovedRolesManager, {
        data: {
          clients: [
            { id: "client-1", name: "Brafer", active: true },
            { id: "client-2", name: "Cliente B", active: true },
          ],
          roles: [
            {
              id: "role-1",
              client_id: "client-1",
              client_name: "Brafer",
              name: "Soldador Brafer",
              active: true,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              created_by: null,
              updated_by: null,
            },
            {
              id: "role-2",
              client_id: "client-2",
              client_name: "Cliente B",
              name: "Montador Cliente B",
              active: true,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              created_by: null,
              updated_by: null,
            },
          ],
        },
        canManage: false,
      }),
    );

    expect(markup).toContain("Soldador Brafer");
    expect(markup).not.toContain("Montador Cliente B");
    expect(markup).not.toContain("Editar cargo");
    expect(markup).not.toContain("Excluir cargo");
  });
});
