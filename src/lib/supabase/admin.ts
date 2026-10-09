import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Cliente administrativo (service role) — IGNORA o RLS.
 *
 * Uso restrito a Server Actions/serviços já autorizados por
 * `requireCapability("users.manage")`: gestão de contas no Supabase Auth
 * (criar usuário, listar para a tela de configurações, gerar link de
 * redefinição). Esta é a única finalidade prevista da
 * SUPABASE_SERVICE_ROLE_KEY — nunca importar em componente de UI ou em
 * código executado no browser.
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
