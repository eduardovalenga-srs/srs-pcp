import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { gestaoEntregasSheet } from "@/lib/export/columns";
import { EXPORT_PAGE_SIZE, collectAllPages, exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponse } from "@/lib/export/workbook";
import { getActiveProcesses, getProductionOrderRows } from "@/lib/repositories/production.repository";
import { createClient } from "@/lib/supabase/server";
import { todayISODate } from "@/lib/utils/dates";
import { parseProductionFilters } from "@/lib/utils/filters";
import { errorMessage } from "@/lib/utils/supabase-result";

/**
 * GET /api/export/gestao-entregas — .xlsx da gestão de OF com a lista
 * filtrada INTEIRA (todas as páginas), nas mesmas colunas da tela.
 *
 * Mesmos filtros da URL (a query string da tela vai junto), mesma permissão
 * da página e a mesma ordenação vigente — a exportação é um download da
 * lista que o usuário já está vendo, não um relatório à parte.
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "production.view")) {
      return Response.json({ error: "Seu perfil não tem permissão para exportar esta lista." }, { status: 403 });
    }

    const filters = parseProductionFilters(searchParamsRecord(request));
    const client = await createClient();
    const today = todayISODate();

    const processes = await getActiveProcesses(client);
    const rows = await collectAllPages((page) =>
      getProductionOrderRows(client, { ...filters, page, pageSize: EXPORT_PAGE_SIZE }, today),
    );

    return workbookResponse(exportFileName("gestao-entregas"), gestaoEntregasSheet(rows, processes, today));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
