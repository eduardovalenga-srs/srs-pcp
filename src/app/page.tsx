import { redirect } from "next/navigation";

import { homePathFor } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Raiz do app: manda cada sessão para a sua página inicial (os operadores
 * só enxergam a sua fábrica) e quem não está logado vai para o login.
 */
export default async function RootPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  redirect(homePathFor(sessionUser.role));
}
