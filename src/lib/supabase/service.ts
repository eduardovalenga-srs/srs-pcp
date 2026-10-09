import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServiceRoleKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Cliente com a SERVICE ROLE KEY (ignora RLS).
 *
 * RESTRITO ao servidor: use apenas em Server Actions / Route Handlers
 * em que a operação foi explicitamente autorizada antes da chamada.
 *
 * O fluxo normal da aplicação (pedidos, produção, importação) NÃO usa
 * este cliente — tudo passa pelo client da sessão, com RLS ativa.
 *
 * NUNCA importe este arquivo em componentes React.
 */
export function createServiceRoleClient() {
  return createClient<Database>(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
