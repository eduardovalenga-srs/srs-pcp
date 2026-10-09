import { describe, expect, it, vi } from "vitest";

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

import { can } from "@/lib/auth/permissions";
import {
  generateTempPassword,
  validateActivation,
  validateRoleChange,
} from "@/lib/services/users.service";
import {
  changePasswordSchema,
  createUserSchema,
  forgotPasswordSchema,
} from "@/lib/validators/user.schema";

describe("createUserSchema", () => {
  it("aceita dados válidos e normaliza o e-mail", () => {
    const parsed = createUserSchema.parse({
      name: "  Maria Silva  ",
      email: "  Maria@Serralheria.COM.br ",
      role: "GESTOR",
    });
    expect(parsed.name).toBe("Maria Silva");
    expect(parsed.email).toBe("maria@serralheria.com.br");
    expect(parsed.role).toBe("GESTOR");
  });

  it("recusa e-mail, perfil e nome inválidos", () => {
    expect(
      createUserSchema.safeParse({ name: "Ana", email: "email-invalido", role: "OPERADOR" })
        .success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({ name: "Ana", email: "ana@x.com", role: "SUPER" }).success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({ name: "   ", email: "ana@x.com", role: "OPERADOR" }).success,
    ).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("exige confirmação igual e mínimo de 8 caracteres", () => {
    const mismatch = changePasswordSchema.safeParse({
      newPassword: "senha-longa",
      confirmPassword: "outra-senha",
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      expect(mismatch.error.issues[0]?.message).toBe("As senhas não conferem");
    }

    expect(
      changePasswordSchema.safeParse({ newPassword: "1234567", confirmPassword: "1234567" })
        .success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ newPassword: "senha-ok-1", confirmPassword: "senha-ok-1" })
        .success,
    ).toBe(true);
  });
});

describe("forgotPasswordSchema", () => {
  it("valida e normaliza o e-mail", () => {
    expect(forgotPasswordSchema.parse("  USER@X.COM ")).toBe("user@x.com");
    expect(forgotPasswordSchema.safeParse("sem-arroba").success).toBe(false);
    expect(forgotPasswordSchema.safeParse("").success).toBe(false);
  });
});

describe("validateRoleChange", () => {
  const base = {
    sessionUserId: "sess-1",
    targetId: "alvo-1",
    currentRole: "ADMIN" as const,
    newRole: "GESTOR" as const,
    otherActiveAdmins: 1,
  };

  it("impede alterar o próprio perfil", () => {
    expect(
      validateRoleChange({ ...base, targetId: "sess-1", otherActiveAdmins: 2 }),
    ).toBe("Você não pode alterar o próprio perfil.");
  });

  it("impede rebaixar o último administrador ativo", () => {
    expect(validateRoleChange({ ...base, otherActiveAdmins: 0 })).toBe(
      "Não é possível rebaixar o último administrador.",
    );
  });

  it("deixa rebaixar quando sobra outro administrador ativo", () => {
    expect(validateRoleChange(base)).toBeNull();
  });

  it("permite rebaixar perfis que não são ADMIN e promover qualquer um", () => {
    expect(
      validateRoleChange({
        ...base,
        currentRole: "GESTOR",
        newRole: "OPERADOR",
        otherActiveAdmins: 0,
      }),
    ).toBeNull();
    expect(
      validateRoleChange({ ...base, newRole: "ADMIN", otherActiveAdmins: 0 }),
    ).toBeNull();
  });
});

describe("validateActivation", () => {
  const base = {
    sessionUserId: "sess-1",
    targetId: "alvo-1",
    targetRole: "OPERADOR" as const,
    active: false,
    otherActiveAdmins: 0,
  };

  it("impede desativar a própria conta", () => {
    expect(validateActivation({ ...base, targetId: "sess-1" })).toBe(
      "Você não pode desativar a si mesmo.",
    );
  });

  it("impede desativar o último administrador ativo", () => {
    expect(validateActivation({ ...base, targetRole: "ADMIN" })).toBe(
      "Não é possível desativar o último administrador.",
    );
  });

  it("deixa desativar quando sobra outro administrador ativo", () => {
    expect(
      validateActivation({ ...base, targetRole: "ADMIN", otherActiveAdmins: 1 }),
    ).toBeNull();
  });

  it("reativação é sempre livre e desativar não-admin é liberado", () => {
    expect(validateActivation({ ...base, active: true, targetRole: "ADMIN" })).toBeNull();
    expect(validateActivation(base)).toBeNull();
  });
});

describe("generateTempPassword", () => {
  it("gera 12 caracteres sem ambíguos (0/O/1/l ausentes)", () => {
    const password = generateTempPassword();
    expect(password).toHaveLength(12);
    expect(password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{12}$/);
    expect(password).not.toMatch(/[01OlI]/);
  });

  it("sempre mistura maiúscula, minúscula e dígito", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTempPassword();
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[2-9]/);
    }
  });

  it("não repete senhas em sequências curtas (CSPRNG)", () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generateTempPassword()));
    expect(passwords.size).toBe(100);
  });
});

describe("permissions (users.manage + settings.manage)", () => {
  it("somente ADMIN gerencia usuários e abre configurações", () => {
    expect(can("ADMIN", "users.manage")).toBe(true);
    expect(can("GESTOR", "users.manage")).toBe(false);
    expect(can("OPERADOR", "users.manage")).toBe(false);
    expect(can("VISUALIZADOR", "users.manage")).toBe(false);

    expect(can("ADMIN", "settings.manage")).toBe(true);
    expect(can("GESTOR", "settings.manage")).toBe(false);
    expect(can("OPERADOR", "settings.manage")).toBe(false);
  });
});
