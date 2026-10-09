import { randomInt } from "node:crypto";

import type { Role } from "@/lib/constants/orders";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseServer } from "@/lib/supabase/types";
import {
  clearMustChangePassword,
  countActiveAdmins,
  findProfileByEmail,
  getProfileById,
  listProfiles,
  setProfileActive,
  updateProfileRole,
  type ProfileEntry,
} from "@/lib/repositories/profiles.repository";
import type { CreateUserValues } from "@/lib/validators/user.schema";

// ------------------------------------------------------------------
// Regras puras (testáveis sem banco/Auth)
// ------------------------------------------------------------------

/** Rebaixamento de perfil: nem a si mesmo, nunca sem ADMIN ativo. */
export function validateRoleChange(params: {
  sessionUserId: string;
  targetId: string;
  currentRole: Role;
  newRole: Role;
  /** Administradores ativos descontando o próprio alvo. */
  otherActiveAdmins: number;
}): string | null {
  if (params.sessionUserId === params.targetId) {
    return "Você não pode alterar o próprio perfil.";
  }
  if (
    params.currentRole === "ADMIN" &&
    params.newRole !== "ADMIN" &&
    params.otherActiveAdmins < 1
  ) {
    return "Não é possível rebaixar o último administrador.";
  }
  return null;
}

/** Desativação: nem a si mesmo, nunca sem ADMIN ativo (reativação é livre). */
export function validateActivation(params: {
  sessionUserId: string;
  targetId: string;
  targetRole: Role;
  active: boolean;
  otherActiveAdmins: number;
}): string | null {
  if (params.active) return null;
  if (params.sessionUserId === params.targetId) {
    return "Você não pode desativar a si mesmo.";
  }
  if (params.targetRole === "ADMIN" && params.otherActiveAdmins < 1) {
    return "Não é possível desativar o último administrador.";
  }
  return null;
}

// ------------------------------------------------------------------
// Senha temporária (entregue fora do app; o banner exige a troca)
// ------------------------------------------------------------------

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I e O
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // sem l (parece 1)
const DIGITS = "23456789"; // sem 0 e 1
const ALL = UPPER + LOWER + DIGITS;

/** Senha temporária legível: 12 caracteres, sem ambíguos, sempre com
 * maiúscula, minúscula e dígito. Gerada com CSPRNG (`node:crypto`). */
export function generateTempPassword(length = 12): string {
  const pick = (alphabet: string): string => alphabet[randomInt(alphabet.length)];

  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));

  // Embaralhamento Fisher–Yates com o mesmo CSPRNG.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ------------------------------------------------------------------
// Usuários gerenciados (profiles + dados do Auth para a tela)
// ------------------------------------------------------------------

export interface ManagedUser extends ProfileEntry {
  /** Último login no Supabase Auth (null = nunca entrou). */
  lastSignInAt: string | null;
}

/**
 * Lista para /configuracoes: profiles via cliente de sessão (RLS) e
 * último acesso via Auth admin (best-effort — sem a service key a tela
 * continua útil, apenas sem a coluna de acesso).
 */
export async function listManagedUsers(client: SupabaseServer): Promise<ManagedUser[]> {
  const profiles = await listProfiles(client);
  const lastSignIn = new Map<string, string>();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const user of data.users) {
      if (user.last_sign_in_at) lastSignIn.set(user.id, user.last_sign_in_at);
    }
  } catch (error) {
    console.error("[listManagedUsers] Auth admin indisponível:", error);
  }

  return profiles.map((profile) => ({
    ...profile,
    lastSignInAt: lastSignIn.get(profile.id) ?? null,
  }));
}

// ------------------------------------------------------------------
// Criação de conta (senha temporária — decisão do produto)
// ------------------------------------------------------------------

export interface CreateTempPasswordResult {
  userId: string;
  email: string;
  tempPassword: string;
}

/**
 * Cria a conta no Supabase Auth com senha temporária confirmada e
 * aplica o perfil escolhido + `must_change_password` (o trigger
 * `handle_new_user` nasce o profile como OPERADOR).
 */
export async function createTempPasswordUser(
  client: SupabaseServer,
  input: CreateUserValues,
): Promise<CreateTempPasswordResult> {
  const existing = await findProfileByEmail(client, input.email);
  if (existing) {
    throw new Error("Já existe um usuário com este e-mail.");
  }

  const tempPassword = generateTempPassword();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name: input.name },
  });

  if (error) {
    if (/already been registered|already registered|already exists/i.test(error.message)) {
      throw new Error("Já existe um usuário com este e-mail.");
    }
    throw new Error(error.message);
  }

  // O profile nasce com o trigger; aplica perfil + flag de troca.
  await updateProfileRole(client, data.user.id, input.role);
  const { error: flagError } = await client
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", data.user.id);
  if (flagError) throw new Error(flagError.message);

  return { userId: data.user.id, email: input.email, tempPassword };
}

// ------------------------------------------------------------------
// Operações com regras (último admin + auto-proteção)
// ------------------------------------------------------------------

/** Altera o perfil de OUTRO usuário aplicando as proteções. */
export async function changeRoleWithRules(
  client: SupabaseServer,
  sessionUserId: string,
  profileId: string,
  newRole: Role,
): Promise<void> {
  const target = await getProfileById(client, profileId);
  if (!target) throw new Error("Usuário não encontrado.");

  const activeAdmins = await countActiveAdmins(client);
  const otherActiveAdmins = activeAdmins - (target.active && target.role === "ADMIN" ? 1 : 0);

  const problem = validateRoleChange({
    sessionUserId,
    targetId: target.id,
    currentRole: target.role,
    newRole,
    otherActiveAdmins,
  });
  if (problem) throw new Error(problem);

  await updateProfileRole(client, profileId, newRole);
}

/** Ativa/desativa uma conta aplicando as proteções. */
export async function setProfileActiveWithRules(
  client: SupabaseServer,
  sessionUserId: string,
  profileId: string,
  active: boolean,
): Promise<void> {
  const target = await getProfileById(client, profileId);
  if (!target) throw new Error("Usuário não encontrado.");

  const activeAdmins = await countActiveAdmins(client);
  const otherActiveAdmins = activeAdmins - (target.active && target.role === "ADMIN" ? 1 : 0);

  const problem = validateActivation({
    sessionUserId,
    targetId: target.id,
    targetRole: target.role,
    active,
    otherActiveAdmins,
  });
  if (problem) throw new Error(problem);

  await setProfileActive(client, profileId, active);
}

/**
 * Gera link de recuperação copiável (o ADMIN entrega fora do app).
 * Nenhum e-mail é enviado por este caminho — funciona sem SMTP.
 */
export async function generateRecoveryLink(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });

  if (error) {
    if (/no user registered|not found/i.test(error.message)) {
      throw new Error("Usuário não encontrado no Supabase Auth.");
    }
    throw new Error(error.message);
  }
  return data.properties.action_link;
}

/** Troca a senha da conta da sessão atual e limpa o aviso de troca. */
export async function changeOwnPassword(
  client: SupabaseServer,
  newPassword: string,
): Promise<void> {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    if (/different from the old/i.test(error.message)) {
      throw new Error("A nova senha deve ser diferente da atual.");
    }
    throw new Error(error.message);
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  if (user) {
    await clearMustChangePassword(client, user.id);
  }
}
