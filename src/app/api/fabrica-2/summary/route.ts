import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { searchParamsRecord } from "@/lib/export/common";
import { getFabrica2FilteredSummary } from "@/lib/services/production.service";
import { createClient } from "@/lib/supabase/server";
import { parseProductionFilters } from "@/lib/utils/filters";
import { errorMessage } from "@/lib/utils/supabase-result";

/** KPIs da Fábrica 2 — executados sob demanda, fora da renderização da página. */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "fabrica2.view")) {
      return Response.json({ error: "Seu perfil não tem permissão para ver esta lista." }, { status: 403 });
    }

    const filters = parseProductionFilters(searchParamsRecord(request));
    const client = await createClient();
    const summary = await getFabrica2FilteredSummary(client, filters);
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível carregar o resumo da Fábrica 2.") },
      { status: 500 },
    );
  }
}
