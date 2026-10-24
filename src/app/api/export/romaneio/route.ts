import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { romaneioDocumentSheet, romaneiosListSheet } from "@/lib/export/columns";
import { exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponse } from "@/lib/export/workbook";
import { getRomaneioView, listRomaneiosForExport } from "@/lib/services/romaneio.service";
import { createClient } from "@/lib/supabase/server";
import { firstValue, parseRomaneioFilters } from "@/lib/utils/filters";
import { todayISODate } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";

/**
 * GET /api/export/romaneio — .xlsx do romaneio de expedição:
 *
 *  - `?id=<uuid>`: o DOCUMENTO de um romaneio (cabeçalho da carga, itens
 *    da carga e devolução de matéria-prima com o Σ da OF inteira) — o
 *    botão da tela de detalhe;
 *  - sem `?id`: a LISTA filtrada INTEIRA (todas as páginas), nas mesmas
 *    colunas da tela — o botão da listagem.
 *
 * Mesmos filtros da URL e mesma permissão da página (`romaneio.view`).
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "romaneio.view")) {
      return Response.json(
        { error: "Seu perfil não tem permissão para exportar esta lista." },
        { status: 403 },
      );
    }

    const params = searchParamsRecord(request);
    const client = await createClient();

    const id = firstValue(params.id).trim();
    if (id) {
      const view = await getRomaneioView(client, id, false);
      if (!view) {
        return Response.json({ error: "Romaneio não encontrado." }, { status: 404 });
      }
      return workbookResponse(
        `romaneio-${view.number}_${todayISODate()}.xlsx`,
        romaneioDocumentSheet(view),
      );
    }

    const filters = parseRomaneioFilters(params);
    const romaneios = await listRomaneiosForExport(client, filters);

    return workbookResponse(exportFileName("romaneio"), romaneiosListSheet(romaneios));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
