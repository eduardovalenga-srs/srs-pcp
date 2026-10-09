import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Sempre com a anon key e RLS ativa (a identidade vem do cookie de sessão).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado a partir de um Server Component: o middleware cuida da sessão.
        }
      },
    },
  });
}
