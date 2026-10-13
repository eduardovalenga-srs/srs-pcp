import { beforeEach, describe, expect, it, vi } from "vitest";

// A cadeia session → supabase/server é server-only; o teste roda em node puro.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  maybeSingle: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      getClaims: mocks.getClaims,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
    }),
  }),
}));

import { loginAction } from "@/lib/actions/auth.actions";
import { getSessionState, getSessionUser } from "@/lib/auth/session";
import type { ProfileRow } from "@/lib/types/database";

const AUTH_USER = { id: "u1", email: "ana@srsterceiros.com.br" };

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "u1",
    name: "Ana",
    email: "ana@srsterceiros.com.br",
    role: "GESTOR",
    active: true,
    must_change_password: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function loginFormData(email = "ana@srsterceiros.com.br", password = "segura123"): FormData {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

/** Resposta de auth.getClaims (forma { data: { claims }, error } — 024). */
function mockClaims(user: { id: string; email?: string } | null): void {
  mocks.getClaims.mockResolvedValue({
    data: user ? { claims: { sub: user.id, email: user.email ?? null } } : null,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSessionState (guard de sessão)", () => {
  it("é anonimo quando não há JWT", async () => {
    mockClaims(null);

    expect(await getSessionState()).toEqual({ status: "anonimo" });
  });

  it("é sem-perfil quando o usuário não tem linha em profiles", async () => {
    mockClaims(AUTH_USER);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    expect(await getSessionState()).toEqual({ status: "sem-perfil" });
  });

  it("é inativo quando o perfil existe com active=false", async () => {
    mockClaims(AUTH_USER);
    mocks.maybeSingle.mockResolvedValue({ data: profile({ active: false }), error: null });

    expect(await getSessionState()).toEqual({ status: "inativo" });
  });

  it("é ok quando o perfil existe e está ativo", async () => {
    mockClaims(AUTH_USER);
    mocks.maybeSingle.mockResolvedValue({ data: profile(), error: null });

    const state = await getSessionState();

    expect(state.status).toBe("ok");
    if (state.status !== "ok") throw new Error("estado deveria ser ok");
    expect(state.user.email).toBe("ana@srsterceiros.com.br");
    expect(state.user.role).toBe("GESTOR");
  });
});

describe("getSessionUser (compatibilidade)", () => {
  it("devolve null para estados não-ok e o usuário para ok", async () => {
    mockClaims(AUTH_USER);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getSessionUser()).toBeNull();

    mocks.maybeSingle.mockResolvedValue({ data: profile({ active: false }), error: null });
    expect(await getSessionUser()).toBeNull();

    mocks.maybeSingle.mockResolvedValue({ data: profile(), error: null });
    const user = await getSessionUser();
    expect(user?.id).toBe("u1");
    expect(user?.role).toBe("GESTOR");
  });
});

describe("loginAction (regressão do loop /login ↔ painel)", () => {
  it("credenciais inválidas: devolve erro genérico sem derrubar sessão", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "invalid_credentials" } });

    const state = await loginAction({ error: null }, loginFormData());

    expect(state).toEqual({ error: "E-mail ou senha inválidos." });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("perfil ativo: redireciona para a home do papel (GESTOR → gestão)", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: profile({ role: "GESTOR" }), error: null });

    await loginAction({ error: null }, loginFormData());

    expect(mocks.redirect).toHaveBeenCalledWith("/gestao-entregas");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("OPERADOR (sem production.view) vai para /fabrica-1", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: profile({ role: "OPERADOR" }), error: null });

    await loginAction({ error: null }, loginFormData());

    expect(mocks.redirect).toHaveBeenCalledWith("/fabrica-1");
  });

  it("SEM PERFIL: derruba a sessão recém-criada e avisa (bug do loop)", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    const state = await loginAction({ error: null }, loginFormData());

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.error).toContain("sem perfil");
  });

  it("perfil inativo: derruba a sessão e avisa", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: profile({ active: false }), error: null });

    const state = await loginAction({ error: null }, loginFormData());

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.error).toContain("desativado");
  });
});
