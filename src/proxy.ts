import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16: `middleware.ts` foi renomeado para `proxy.ts`.
 * Atualiza a sessão do Supabase e aplica o guard de rotas de UI.
 * Rotas `/api` ficam de fora: cada handler responde 401 com JSON.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
