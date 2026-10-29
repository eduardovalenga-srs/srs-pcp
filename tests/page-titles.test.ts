import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Padrão das abas do navegador: o layout raiz declara
 * `title: { default: "Imperatriz", template: "%s · Imperatriz" }`, mas o
 * template SÓ se aplica a quem exporta `title` próprio — quem não exporta
 * mostra apenas "Imperatriz" (sem o nome da tela). Este teste trava o
 * inventário: toda tela precisa do export com o título esperado.
 *
 * A raiz (src/app/page.tsx) fica de fora: ela só redireciona para a home
 * do perfil e nunca renderiza um título próprio. Se uma tela passar a usar
 * `generateMetadata`, atualize a leitura abaixo junto com o inventário.
 */
const EXPECTED_TITLES: Record<string, string> = {
  "acesso-negado": "Acesso negado",
  "(auth)/login": "Entrar",
  "(auth)/redefinir-senha": "Redefinir senha",
  "(dashboard)/configuracoes": "Configurações",
  "(dashboard)/dashboard": "Dashboard",
  "(dashboard)/fabrica-1": "Fábrica 1",
  "(dashboard)/fabrica-2": "Fábrica 2",
  "(dashboard)/gestao-entregas": "Gestão de OF",
  "(dashboard)/importacao": "Importar planilha",
  "(dashboard)/pedidos": "Pedidos",
  "(dashboard)/pedidos/[id]": "Pedido",
  "(dashboard)/pedidos/[id]/editar": "Editar pedido",
  "(dashboard)/pedidos/novo": "Novo pedido",
  "(dashboard)/processos": "Processos",
  "(dashboard)/rh/funcionarios": "Funcionários",
  "(dashboard)/romaneio": "Romaneio",
  "(dashboard)/romaneio/[id]": "Romaneio",
  "(dashboard)/romaneio/novo": "Novo romaneio",
};

const APP_DIR = join(process.cwd(), "src", "app");
const TITLE_RE = /export const metadata = \{ title: "([^"]+)" \}/;

function listPages(): string[] {
  return readdirSync(APP_DIR, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith("page.tsx"));
}

describe("títulos das abas (template \"%s · Imperatriz\")", () => {
  it("nenhuma tela ficou sem export de título", () => {
    const semTitulo = listPages().filter((entry) => {
      if (entry === "page.tsx") return false; // raiz só redireciona
      return !TITLE_RE.test(readFileSync(join(APP_DIR, entry), "utf8"));
    });
    expect(semTitulo).toEqual([]);
  });

  it("cada tela declara exatamente o título esperado", () => {
    const vistos: Record<string, string> = {};
    for (const entry of listPages()) {
      if (entry === "page.tsx") continue;
      const match = TITLE_RE.exec(readFileSync(join(APP_DIR, entry), "utf8"));
      if (match) {
        const route = entry.replace(/\\/g, "/").replace(/\/page\.tsx$/, "");
        vistos[route] = match[1]!;
      }
    }
    expect(vistos).toEqual(EXPECTED_TITLES);
  });
});
