"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { requireSessionUser } from "@/lib/auth/session";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants/orders";
import { getProfileById } from "@/lib/repositories/profiles.repository";
import { createClient } from "@/lib/supabase/server";
import {
  changeOwnPassword,
  changeRoleWithRules,
  createTempPasswordUser,
  generateRecoveryLink,
  setProfileActiveWithRules,
} from "@/lib/services/users.service";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import { changePasswordSchema, createUserSchema } from "@/lib/validators/user.schema";

export interface UserActionResult {
  success: boolean;
  message: string;
  /** Senha temporária — exibida UMA vez no retorno, nunca em log. */
  tempPassword?: string;
  /** Link de recuperação copiável (gerado pelo ADMIN). */
  recoveryLink?: string;
}

/** Cria a conta com senha temporária e aplica o perfil (ADMIN). */
export async function createUserAction(input: unknown): Promise<UserActionResult> {
  try {
    await requireCapability("users.manage");
    const parsed = createUserSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) ?? "Dados inválidos." };
    }

    const client = await createClient();
    const result = await createTempPasswordUser(client, parsed.data);

    revalidatePath("/configuracoes");
    return {
      success: true,
      message: `Usuário ${result.email} criado como ${ROLE_LABELS[parsed.data.role]}.`,
      tempPassword: result.tempPassword,
    };
  } catch (error) {
    console.error("[createUserAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Ativa/desativa a conta (bloqueia login e sessões — nunca há exclusão). */
export async function setUserActiveAction(
  profileId: string,
  active: boolean,
): Promise<UserActionResult> {
  try {
    const sessionUser = await requireCapability("users.manage");
    const client = await createClient();
    await setProfileActiveWithRules(client, sessionUser.id, profileId, active);

    revalidatePath("/configuracoes");
    return {
      success: true,
      message: active
        ? "Usuário reativado."
        : "Usuário desativado. O acesso foi bloqueado.",
    };
  } catch (error) {
    console.error("[setUserActiveAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Altera o perfil de um usuário com proteção do último ADMIN (ADMIN). */
export async function changeUserRoleAction(
  profileId: string,
  role: Role,
): Promise<UserActionResult> {
  try {
    if (!ROLES.includes(role)) {
      return { success: false, message: "Permissão inválida." };
    }
    const sessionUser = await requireCapability("users.manage");
    const client = await createClient();
    await changeRoleWithRules(client, sessionUser.id, profileId, role);

    revalidatePath("/configuracoes");
    return { success: true, message: `Perfil alterado para ${ROLE_LABELS[role]}.` };
  } catch (error) {
    console.error("[changeUserRoleAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/**
 * Gera link de recuperação copiável para o ADMIN entregar fora do app
 * (nenhum e-mail é enviado — funciona sem SMTP).
 */
export async function generateRecoveryLinkAction(profileId: string): Promise<UserActionResult> {
  try {
    await requireCapability("users.manage");
    const client = await createClient();

    const profile = await getProfileById(client, profileId);
    if (!profile?.email) {
      return { success: false, message: "Usuário sem e-mail cadastrado." };
    }

    const link = await generateRecoveryLink(profile.email);
    return {
      success: true,
      message: "Link de redefinição gerado. Compartilhe por canal seguro.",
      recoveryLink: link,
    };
  } catch (error) {
    console.error("[generateRecoveryLinkAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Troca a senha da conta logada (qualquer perfil) e limpa o aviso. */
export async function changeMyPasswordAction(input: unknown): Promise<UserActionResult> {
  try {
    await requireSessionUser();
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) ?? "Dados inválidos." };
    }

    const client = await createClient();
    await changeOwnPassword(client, parsed.data.newPassword);

    revalidatePath("/", "layout");
    return { success: true, message: "Senha alterada com sucesso." };
  } catch (error) {
    console.error("[changeMyPasswordAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}
