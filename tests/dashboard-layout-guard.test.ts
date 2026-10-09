import { beforeEach, describe, expect, it, vi } from "vitest";

// Componente de servidor + cadeia supabase; o teste roda em node puro.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  hasAdmin: vi.fn(),
}));

// redirect() do Next lança uma exceção de controle — o mock replica isso
// para que o guard pare de executar, como em produção.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionState: mocks.getSessionState,
}));
vi.mock("@/lib/repositories/profiles.repository", () => ({
  hasAdmin: mocks.hasAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

// UI do topo não é o alvo do teste.
vi.mock("@/components/layout/TopNav", () => ({ TopNav: () => null }));
vi.mock("@/components/layout/AdminClaimBanner", () => ({ AdminClaimBanner: () => null }));
vi.mock("@/components/layout/PasswordBanner", () => ({ PasswordBanner: () => null }));

import { redirect } from "next/navigation";
import { DashboardLayoutGuard } from "../src/app/(dashboard)/layout-guard";

async function runGuard(state: unknown): Promise<string | "pass"> {
  mocks.getSessionState.mockResolvedValue(state);
  try {
    await DashboardLayoutGuard();
    return "pass";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) return message;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guard do layout do dashboard (anti ERR_TOO_MANY_REDIRECTS)", () => {
  it("anonimo vai para /login", async () => {
    expect(await runGuard({ status: "anonimo" })).toBe("NEXT_REDIRECT:/login");
  });

  it("sem-perfil cai na rota terminal /acesso-negado (não volta ao /login)", async () => {
    expect(await runGuard({ status: "sem-perfil" })).toBe("NEXT_REDIRECT:/acesso-negado");
  });

  it("inativo cai na rota terminal /acesso-negado", async () => {
    expect(await runGuard({ status: "inativo" })).toBe("NEXT_REDIRECT:/acesso-negado");
  });

  it("sessão ok segue para o conteúdo (sem redirect)", async () => {
    const user = { id: "u1", email: "ana@x.com", role: "GESTOR", profile: {} };
    expect(await runGuard({ status: "ok", user })).toBe("pass");
    expect(redirect).not.toHaveBeenCalled();
  });
});
