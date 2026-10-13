import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

const PUBLIC_ROUTES = ["/login"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Atualiza a sessão do Supabase em cada request e aplica o guard de rotas:
 *  - não autenticado  -> /login
 *  - autenticado em /login -> /gestao-entregas
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANTE: não execute código entre createServerClient e auth.getClaims()
  // (024: getClaims lê/valida o JWT localmente em vez de bater com o servidor
  // de auth a cada request — mesmo resultado, um round-trip a menos no proxy).
  const {
    data: claimsData,
  } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  const { pathname } = request.nextUrl;

  if (!userId && !isPublicRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(url);
  }

  if (userId && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/gestao-entregas";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
