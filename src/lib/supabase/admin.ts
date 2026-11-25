import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Cliente administrativo (service role) — IGNORA o RLS.
 *
 * Uso restrito a serviços chamados por Server Actions que validaram
 * `requireAdminUser`: gestão de contas no Supabase Auth, configuração de
 * acesso por usuário e gravação de auditoria. Nunca importar em componente
 * de UI ou em código executado no browser.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(getSupabaseUrl(), getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
