import type { createClient } from "@/lib/supabase/server";

/**
 * Tipo do cliente Supabase usado no servidor.
 * Derivado da fábrica real para nunca divergir dos genéricos.
 */
export type SupabaseServer = Awaited<ReturnType<typeof createClient>>;
