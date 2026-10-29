import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { activeGroupIds, isItemActive, visibleEntries } from "@/lib/navigation";
import type { Role } from "@/lib/constants/orders";

let currentPath = "/gestao-entregas";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: (props: {
      href: string;
      className?: string;
      title?: string;
      "aria-label"?: string;
      "aria-current"?: string;
      onClick?: () => void;
      children?: React.ReactNode;
    }) =>
      h(
        "a",
        {
          href: props.href,
          className: props.className,
          title: props.title,
          "aria-label": props["aria-label"],
          "aria-current": props["aria-current"],
          onClick: props.onClick,
        },
        props.children,
      ),
  };
});

vi.mock("@/lib/actions/auth.actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/lib/actions/users.actions", () => ({ changeMyPasswordAction: vi.fn() }));
// O Radix não renderiza em SSR estático (portal); o foco aqui é a árvore de links.
vi.mock("@/components/auth/ChangePasswordDialog", () => ({ ChangePasswordDialog: () => null }));

const user = { name: "Ana Souza", email: "ana@serralheria.com", role: "GESTOR" as Role };

function renderSidebar(role: Role, path = "/gestao-entregas"): string {
  currentPath = path;
  return renderToStaticMarkup(createElement(AppSidebar, { user: { ...user, role } }));
}

function renderNav(role: Role, path = "/gestao-entregas"): string {
  currentPath = path;
  return renderToStaticMarkup(
    createElement(SidebarNav, { role, pathname: path }),
  );
}

describe("AppSidebar (menu lateral, 043)", () => {
  it("renderiza a navegação lateral com os itens da Gestão de Fábrica (GESTOR)", () => {
    const markup = renderSidebar("GESTOR");

    expect(markup).toContain('aria-label="Navegação principal"');
    expect(markup).toContain('aria-label="Gestão de Fábrica"');
    expect(markup).toContain('href="/gestao-entregas"');
    expect(markup).toContain('aria-label="Gestão de OF"');
    expect(markup).toContain('href="/fabrica-1"');
    expect(markup).toContain('href="/fabrica-2"');
    expect(markup).toContain('href="/romaneio"');
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).toContain('href="/processos"');
  });

  it("marca a página atual com aria-current=page", () => {
    const markup = renderSidebar("GESTOR", "/fabrica-2");

    const link = markup.match(/<a[^>]*href="\/fabrica-2"[^>]*>/)?.[0] ?? "";
    expect(link).toContain('aria-current="page"');

    const other = markup.match(/<a[^>]*href="\/gestao-entregas"[^>]*>/)?.[0] ?? "";
    expect(other).not.toContain('aria-current="page"');
  });

  it("mantém a Configurações fora da sidebar (vive no menu do usuário)", () => {
    const markup = renderSidebar("ADMIN");

    expect(markup).not.toContain('href="/configuracoes"');
    expect(markup).not.toContain('href="/importacao"');
  });

  it("abre o grupo da rota atual e deixa os demais fechados", () => {
    // Rota do RH => só o grupo RH vem aberto (Gestão de Fábrica recolhida).
    const markup = renderSidebar("ADMIN", "/rh/funcionarios");

    const groups = [...markup.matchAll(/<button[^>]*aria-label="(Gestão de Fábrica|RH)"[^>]*>/g)].map(
      (match) => match[0],
    );
    const fabrica = groups.find((g) => g.includes("Gestão de Fábrica")) ?? "";
    const rh = groups.find((g) => g.includes('aria-label="RH"')) ?? "";

    expect(fabrica).toContain('aria-expanded="false"');
    expect(rh).toContain('aria-expanded="true"');
  });

  it("expande a sidebar por padrão (estado inicial do servidor)", () => {
    const markup = renderSidebar("GESTOR");

    expect(markup).toContain("w-60");
    expect(markup).toContain('aria-label="Recolher menu"');
  });
});

describe("filtragem por papel (capabilities da sidebar)", () => {
  it("OPERADOR vê Fábrica 1, Dashboard e RH — sem gestão de entregas nem edições", () => {
    const markup = renderSidebar("OPERADOR");

    expect(markup).toContain('href="/fabrica-1"');
    expect(markup).not.toContain('href="/gestao-entregas"');
    expect(markup).not.toContain('href="/fabrica-2"');
    expect(markup).not.toContain('href="/romaneio"');
    expect(markup).not.toContain('href="/processos"');
    // 043: Dashboard virou entrada de primeiro nível e o OPERADOR a vê.
    expect(markup).toContain('href="/dashboard"');
    // 043: RH passa a ser de ADMIN e OPERADOR.
    expect(markup).toContain('href="/rh/funcionarios"');
  });

  it("VISUALIZADOR vê Gestão de OF, Fábrica 1 e Romaneio — sem RH", () => {
    const markup = renderSidebar("VISUALIZADOR");

    expect(markup).toContain('href="/gestao-entregas"');
    expect(markup).toContain('href="/fabrica-1"');
    expect(markup).toContain('href="/romaneio"');
    expect(markup).not.toContain('href="/fabrica-2"');
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/processos"');
    expect(markup).not.toContain('href="/rh/funcionarios"');
  });

  it("ADMIN e OPERADOR veem o grupo RH", () => {
    for (const role of ["ADMIN", "OPERADOR"] as const) {
      const markup = renderSidebar(role);
      expect(markup, `grupo RH para ${role}`).toContain('href="/rh/funcionarios"');
    }
  });
});

describe("modo recolhido (trilha de ícones)", () => {
  it("esconde os rótulos do fluxo e os transforma em tooltip nativo", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarNav, { role: "GESTOR" as Role, pathname: "/gestao-entregas", collapsed: true }),
    );

    // Nenhum rótulo como TEXTO visível (>nome<) — só em atributos.
    expect(markup).not.toContain(">Gestão de OF<");
    expect(markup).not.toContain(">Fábrica 1<");
    // Continua legível para leitor de tela e tooltip nativo.
    expect(markup).toContain('title="Gestão de OF"');
    expect(markup).toContain('aria-label="Gestão de OF"');
    // Grupo recolhido não desdobra dentro da trilha (sem aria-expanded).
    expect(markup).not.toContain("aria-expanded");
  });

  it("mantém os rótulos visíveis no modo expandido", () => {
    const markup = renderNav("GESTOR");

    expect(markup).toContain("Gestão de OF");
    expect(markup).toContain("Gestão de Fábrica");
  });
});

describe("helpers de navegação", () => {
  it("isItemActive casa a rota exata e subrotas, sem falso positivo de prefixo", () => {
    expect(isItemActive("/fabrica-1", "/fabrica-1")).toBe(true);
    expect(isItemActive("/fabrica-1/editar", "/fabrica-1")).toBe(true);
    expect(isItemActive("/fabrica-10", "/fabrica-1")).toBe(false);
    expect(isItemActive("/gestao-entregas", "/fabrica-1")).toBe(false);
  });

  it("activeGroupIds devolve o grupo que contém a rota", () => {
    const entries = visibleEntries("ADMIN");

    expect(activeGroupIds("/gestao-entregas", entries)).toContain("fabrica");
    expect(activeGroupIds("/rh/funcionarios", entries)).toEqual(["rh"]);
    expect(activeGroupIds("/fora-do-menu", entries)).toEqual([]);
  });

  it("visibleEntries nunca devolve grupo sem itens", () => {
    for (const role of ["ADMIN", "GESTOR", "OPERADOR", "VISUALIZADOR"] as const) {
      const entries = visibleEntries(role);
      for (const entry of entries) {
        expect(entry.type === "group" ? entry.items.length > 0 : true, `${role} → ${entry.type}`).toBe(true);
      }
    }
  });

  it("VISUALIZADOR não recebe o grupo RH nem a capacidade de edição", () => {
    const entries = visibleEntries("VISUALIZADOR");

    expect(entries.some((entry) => entry.type === "group" && entry.id === "rh")).toBe(false);
  });
});
