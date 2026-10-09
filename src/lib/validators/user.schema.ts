import { z } from "zod";

import { ROLES } from "@/lib/constants/orders";

/** Novo usuário criado pelo ADMIN (recebe senha temporária). */
export const createUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome")
    .max(80, "Máximo de 80 caracteres"),
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail")
    .max(254, "Máximo de 254 caracteres")
    .email("E-mail inválido")
    .transform((value) => value.toLowerCase()),
  role: z.enum(ROLES, { message: "Selecione um perfil válido" }),
});

export type CreateUserInput = z.input<typeof createUserSchema>;
export type CreateUserValues = z.output<typeof createUserSchema>;

/** Troca de senha (própria conta — diálogo/banner ou fluxo de recuperação). */
export const changePasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, "Mínimo de 8 caracteres")
      .max(72, "Máximo de 72 caracteres"),
    confirmPassword: z.string().min(1, "Repita a nova senha"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

/** "Esqueci minha senha" na tela de login. */
export const forgotPasswordSchema = z
  .string()
  .trim()
  .min(1, "Informe o e-mail")
  .max(254, "Máximo de 254 caracteres")
  .email("E-mail inválido")
  .transform((value) => value.toLowerCase());
