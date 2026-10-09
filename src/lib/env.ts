/**
 * Leitura validada das variáveis de ambiente.
 * Mantém todo o acesso a env centralizado (facilita testes e deploy).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} ausente. Copie .env.example para .env.local e preencha os valores do Supabase.`,
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

/**
 * Chave de serviço (server-only).
 * Nunca deve ser importada por código executado no browser.
 */
export function getServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function getImportMaxFileSize(): number {
  const raw = process.env.IMPORT_MAX_FILE_SIZE;
  if (!raw) return 20 * 1024 * 1024;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20 * 1024 * 1024;
}
