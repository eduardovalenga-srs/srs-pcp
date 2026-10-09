import type { Role } from "@/lib/constants/orders";
import type { SupabaseServer } from "@/lib/supabase/types";
import { assertOk } from "@/lib/utils/supabase-result";

export interface ProfileEntry {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
}

/** Lista de perfis (para configurações e exibição de responsáveis). */
export async function listProfiles(client: SupabaseServer): Promise<ProfileEntry[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id, name, email, role, active, must_change_password")
    .order("name", { ascending: true });

  assertOk(error, "Não foi possível carregar os usuários");
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
  }));
}

/** Perfil por id (com status). */
export async function getProfileById(
  client: SupabaseServer,
  profileId: string,
): Promise<ProfileEntry | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, name, email, role, active, must_change_password")
    .eq("id", profileId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o usuário");
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    active: data.active,
    mustChangePassword: data.must_change_password,
  };
}

/** Perfil por e-mail (evita duplicidade na criação). */
export async function findProfileByEmail(
  client: SupabaseServer,
  email: string,
): Promise<ProfileEntry | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, name, email, role, active, must_change_password")
    .ilike("email", email)
    .maybeSingle();

  assertOk(error, "Não foi possível verificar o e-mail");
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    active: data.active,
    mustChangePassword: data.must_change_password,
  };
}

/** Altera o papel de um usuário (somente ADMIN — RLS reforça). */
export async function updateProfileRole(
  client: SupabaseServer,
  profileId: string,
  role: Role,
): Promise<void> {
  const { error } = await client.from("profiles").update({ role }).eq("id", profileId);
  assertOk(error, "Não foi possível alterar a permissão");
}

/** Ativa/desativa a conta (somente ADMIN — RLS reforça). */
export async function setProfileActive(
  client: SupabaseServer,
  profileId: string,
  active: boolean,
): Promise<void> {
  const { error } = await client.from("profiles").update({ active }).eq("id", profileId);
  assertOk(error, "Não foi possível alterar o status");
}

/** Limpa o aviso de senha temporária (linha própria — RLS deixa). */
export async function clearMustChangePassword(
  client: SupabaseServer,
  profileId: string,
): Promise<void> {
  const { error } = await client
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", profileId);
  assertOk(error, "Não foi possível atualizar o perfil");
}

/** Quantidade de contas ADMIN ativas (proteção do último administrador). */
export async function countActiveAdmins(client: SupabaseServer): Promise<number> {
  const { count, error } = await client
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "ADMIN")
    .eq("active", true);

  assertOk(error, "Não foi possível verificar administradores");
  return count ?? 0;
}

export async function hasAdmin(client: SupabaseServer): Promise<boolean> {
  const { data, error } = await client.from("profiles").select("id").eq("role", "ADMIN").limit(1);
  assertOk(error, "Não foi possível verificar permissões");
  return (data ?? []).length > 0;
}
