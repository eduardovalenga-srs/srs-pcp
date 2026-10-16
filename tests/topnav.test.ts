import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TopNav } from "@/components/layout/TopNav";
import { ROLE_LABELS, type Role } from "@/lib/constants/orders";

vi.mock("next/navigation", () => ({
  usePathname: () => "/gestao-entregas",
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
      children?: ReactNode;
    }) =>
      h(
        "a",
        {
          href: props.href,
          className: props.className,
          title: props.title,
          "aria-label": props["aria-label"],
          "aria-current": props["aria-current"],
        },
        props.children,
      ),
  };
});

vi.mock("@/lib/actions/auth.actions", () => ({ logoutAction: vi.fn() }));

// A cadeia das actions de usuário é server-only; o diálogo só a invoca em submit.
vi.mock("@/lib/actions/users.actions", () => ({ changeMyPasswordAction: vi.fn() }));

const user = { name: "Ana Souza", email: "ana@serralheria.com", role: "GESTOR" as Role };

function renderFor(role: Role): string {
  return renderToStaticMarkup(createElement(TopNav, { user: { ...user, role } }));
}

describe("TopNav (menu no topo)", () => {
  it("renderiza os links no topo com a página atual marcada (GESTOR)", () => {
    const markup = renderFor("GESTOR");

    expect(markup).toContain('aria-label="Navegação principal"');
    expect(markup).toContain('href="/gestao-entregas"');
    expect(markup).toContain('aria-label="Gestão de OF"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/fabrica-1"');
    expect(markup).toContain('aria-label="Fábrica 1"');
    // Fábrica 2 entra logo após a Fábrica 1 (ADMIN/GESTOR).
    expect(markup).toContain('href="/fabrica-2"');
    expect(markup).toContain('aria-label="Fábrica 2"');
    expect(markup).toContain('href="/dashboard"');
    // Importação saiu da barra — o acesso é pelo botão da gestão de entregas.
    expect(markup).not.toContain('href="/importacao"');
    expect(markup).not.toContain('aria-label="Importar Excel"');
    expect(markup).toContain('href="/processos"');
    // Entre lg e xl só os ícones aparecem — o rótulo fica oculto para não disputar largura.
    expect(markup).toContain("hidden xl:inline");
    // Configurações fica no menu do usuário (só ADMIN) — nunca na barra.
    expect(markup).not.toContain('href="/configuracoes"');
  });

  it("mostra só o nome na barra; perfil, alterar senha e sair ficam no menu do usuário", () => {
    const markup = renderFor("GESTOR");

    expect(markup).toContain("Imperatriz");
    // O brasão da tela de login marca o nome na barra (desktop e gaveta).
    // O next/image serve o arquivo via /_next/image?url=..., então a
    // checagem casa o nome do arquivo em qualquer forma.
    expect(markup).toContain("logo_imperatriz.png");
    expect(markup).not.toContain("logo.png");
    expect(markup).not.toContain("Controle de Produção");
    expect(markup).toContain("Ana Souza");
    expect(markup).toContain('aria-label="Menu do usuário"');
    expect(markup).toContain('aria-haspopup="menu"');
    // Fora da barra: badge de perfil, botão de trocar senha e sair.
    expect(markup).not.toContain(ROLE_LABELS[user.role]);
    expect(markup).not.toContain('aria-label="Alterar senha"');
    expect(markup).not.toContain("Sair da aplicação");
    // Gaveta mobile fechada por padrão.
    expect(markup).toContain('aria-label="Abrir menu"');
    expect(markup).not.toContain('role="dialog"');
  });

  it("OPERADOR vê apenas a Fábrica 1 na barra", () => {
    const markup = renderFor("OPERADOR");

    // Fluxo do OPERADOR: Fábrica 1 → link da OF → folha do processo.
    expect(markup).toContain('href="/fabrica-1"');
    expect(markup).toContain('aria-label="Fábrica 1"');
    // Gestão de Entregas saiu da barra dele (capability menu.gestao).
    expect(markup).not.toContain('href="/gestao-entregas"');
    expect(markup).not.toContain('href="/fabrica-2"');
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/importacao"');
    expect(markup).not.toContain('href="/processos"');
    expect(markup).not.toContain('href="/configuracoes"');
    // O menu do usuário continua disponível (nome na barra).
    expect(markup).toContain('aria-label="Menu do usuário"');
  });

  it("VISUALIZADOR vê a gestão de entregas e a Fábrica 1", () => {
    const markup = renderFor("VISUALIZADOR");

    expect(markup).toContain('href="/gestao-entregas"');
    // Fábrica 1 é leitura de materiais — disponível para todos os perfis.
    expect(markup).toContain('href="/fabrica-1"');
    // Fábrica 2 é restrita a ADMIN/GESTOR.
    expect(markup).not.toContain('href="/fabrica-2"');
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/importacao"');
    expect(markup).not.toContain('href="/processos"');
    expect(markup).not.toContain('href="/configuracoes"');
    // O menu do usuário continua disponível (nome na barra).
    expect(markup).toContain('aria-label="Menu do usuário"');
  });

  it("ADMIN vê todos os menus de navegação da barra", () => {
    const markup = renderFor("ADMIN");

    expect(markup).toContain('href="/gestao-entregas"');
    expect(markup).toContain('href="/fabrica-1"');
    expect(markup).toContain('href="/fabrica-2"');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/importacao"');
    expect(markup).toContain('href="/processos"');
    // Configurações segue fora da barra — vive no menu do usuário.
    expect(markup).not.toContain('href="/configuracoes"');
  });

  it("não expõe \"Pedidos\" no menu — a gestão de entregas é o hub", () => {
    const markup = renderFor("GESTOR");

    expect(markup).not.toContain('href="/pedidos"');
    expect(markup).not.toContain(">Pedidos<");
  });
});
