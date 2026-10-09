import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/types/database";

/**
 * Cliente de navegador (fluxo PKCE) — usado apenas no fluxo PÚBLICO de
 * redefinição de senha (troca do `?code=` do link de recuperação e
 * `updateUser` na própria sessão). Demais telas usam o cliente de
 * servidor com RLS (`@/lib/supabase/server`).
 *
 * Os nomes são literais de propósito: `process.env` dinâmico não é
 * substituído no bundle do browser.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Variáveis NEXT_PUBLIC_SUPABASE_* ausentes no bundle do navegador.");
  }
  return createSupabaseBrowserClient<Database>(url, anonKey);
}
