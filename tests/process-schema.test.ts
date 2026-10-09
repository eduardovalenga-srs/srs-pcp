import { describe, expect, it } from "vitest";

import {
  createProcessSchema,
  reorderProcessesSchema,
  updateProcessSchema,
} from "@/lib/validators/process.schema";

describe("createProcessSchema (local + duração)", () => {
  it("local em branco vira null e duração aceita texto digitado", () => {
    const parsed = createProcessSchema.safeParse({
      code: "PINTURA",
      name: "Pintura",
      location: "  ",
      durationDays: "3",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.location).toBeNull();
    expect(parsed.data.durationDays).toBe(3);
    // A ordem de exibição não vem do formulário: o servidor anexa ao final.
    expect("displayOrder" in parsed.data).toBe(false);
  });

  it("mantém o local preenchido com espaos nas pontas", () => {
    const parsed = createProcessSchema.safeParse({
      code: "PINTURA",
      name: "Pintura",
      location: "  Fábrica 1  ",
      durationDays: 2,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.location).toBe("Fábrica 1");
  });

  it("duração é obrigatória com mensagem em pt-BR", () => {
    const parsed = createProcessSchema.safeParse({
      code: "PINTURA",
      name: "Pintura",
      location: null,
      durationDays: "",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("Informe a duração do processo em dias");
  });

  it("valida a faixa de dias (1 a 365) e a parte inteira", () => {
    const base = { code: "PINTURA", name: "Pintura", location: null };

    const zero = createProcessSchema.safeParse({ ...base, durationDays: 0 });
    expect(zero.success).toBe(false);
    if (!zero.success) expect(zero.error.issues[0]?.message).toBe("Mínimo de 1 dia");

    const demais = createProcessSchema.safeParse({ ...base, durationDays: 400 });
    expect(demais.success).toBe(false);
    if (!demais.success) expect(demais.error.issues[0]?.message).toBe("Máximo de 365 dias");

    const fracao = createProcessSchema.safeParse({ ...base, durationDays: "2,5" });
    expect(fracao.success).toBe(false);
    if (!fracao.success) expect(fracao.error.issues[0]?.message).toBe("Use um número inteiro de dias");

    const texto = createProcessSchema.safeParse({ ...base, durationDays: "abc" });
    expect(texto.success).toBe(false);
    if (!texto.success) expect(texto.error.issues[0]?.message).toBe("Duração inválida");
  });
});

describe("updateProcessSchema (local + duração)", () => {
  it("aceita o próprio output — round-trip do formulário de edição", () => {
    const first = updateProcessSchema.safeParse({
      id: "proc-1",
      name: "Serra",
      active: true,
      location: "Fábrica 2",
      durationDays: 5,
    });
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = updateProcessSchema.safeParse(first.data);
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.location).toBe("Fábrica 2");
    expect(second.data.durationDays).toBe(5);
  });

  it("local null passa direto (toggle de ativo sem alterar o campo)", () => {
    const parsed = updateProcessSchema.safeParse({
      id: "proc-1",
      name: "Serra",
      active: false,
      location: null,
      durationDays: 1,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.location).toBeNull();
    expect(parsed.data.active).toBe(false);
  });

  it("não aceita ordem de exibição no formulário (posição muda só no arrastar)", () => {
    const parsed = updateProcessSchema.safeParse({
      id: "proc-1",
      name: "Serra",
      displayOrder: 99,
      active: true,
      location: null,
      durationDays: 1,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Campo extra é removido pelo zod — nunca é persistido pela edição.
    expect("displayOrder" in parsed.data).toBe(false);
  });
});

describe("reorderProcessesSchema (arrastar e soltar)", () => {
  it("aceita a lista completa na nova ordem", () => {
    const parsed = reorderProcessesSchema.safeParse(["uuid-3", "uuid-1", "uuid-2"]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(["uuid-3", "uuid-1", "uuid-2"]);
  });

  it("lista vazia é recusada com mensagem em pt-BR", () => {
    const parsed = reorderProcessesSchema.safeParse([]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("Nenhum processo para reordenar");
  });

  it("id repetido é recusado", () => {
    const parsed = reorderProcessesSchema.safeParse(["uuid-1", "uuid-2", "uuid-1"]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("A lista não pode repetir processos");
  });

  it("id vazio é recusado", () => {
    const parsed = reorderProcessesSchema.safeParse(["uuid-1", ""]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("Processo inválido");
  });
});
