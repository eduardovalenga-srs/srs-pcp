import { redirect } from "next/navigation";

import { homePathFor } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Raiz do app: manda cada sessão para a sua página inicial (o OPERADOR
 * só enxerga a Fábrica 1) e quem não está logado vai para o login.
 */
export default async function RootPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  redirect(homePathFor(sessionUser.role));
}
