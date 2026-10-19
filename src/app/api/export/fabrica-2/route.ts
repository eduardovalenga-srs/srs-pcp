import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { fabrica2Sheet } from "@/lib/export/columns";
import { EXPORT_PAGE_SIZE, collectAllPages, exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponse } from "@/lib/export/workbook";
import { getActiveProcesses, getProductionRows } from "@/lib/repositories/production.repository";
import { createClient } from "@/lib/supabase/server";
import { todayISODate } from "@/lib/utils/dates";
import { parseProductionFilters } from "@/lib/utils/filters";
import { errorMessage } from "@/lib/utils/supabase-result";

/**
 * GET /api/export/fabrica-2 — .xlsx da lista filtrada INTEIRA da Fábrica 2
 * (todas as páginas), nas mesmas colunas da tela — a cadeia da Fábrica 1
 * continua oculta, como na tabela.
 *
 * Mesmos filtros da URL, mesma permissão da página (`fabrica2.view`) e a
 * mesma ordenação vigente.
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "fabrica2.view")) {
      return Response.json({ error: "Seu perfil não tem permissão para exportar esta lista." }, { status: 403 });
    }

    const filters = parseProductionFilters(searchParamsRecord(request));
    const client = await createClient();
    const today = todayISODate();

    const processes = await getActiveProcesses(client);
    const rows = await collectAllPages((page) =>
      getProductionRows(client, { ...filters, page, pageSize: EXPORT_PAGE_SIZE }, today),
    );

    return workbookResponse(exportFileName("fabrica-2"), fabrica2Sheet(rows, processes, today));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
