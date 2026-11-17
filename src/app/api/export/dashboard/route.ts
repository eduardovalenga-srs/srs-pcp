import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { dashboardWeightSheets } from "@/lib/export/columns";
import { exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponseSheets } from "@/lib/export/workbook";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { listProductGroupOptions } from "@/lib/repositories/product-groups.repository";
import { getDashboardCompletedWeight } from "@/lib/services/production.service";
import { createClient } from "@/lib/supabase/server";
import { todayISODate } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";
import { weightProcessColumns } from "@/lib/utils/weight-columns";
import { parseWeightSelection } from "@/lib/utils/weight-selection";

/** Parâmetro único (a query string pode repetir a chave). */
function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * GET /api/export/dashboard — .xlsx do painel "Peso concluído por processo".
 *
 * A planilha espelha o recorte VIGENTE na tela (granularidade, âncora,
 * processo e família), com a lista Dia × processo e abas de apoio:
 * totais por processo, famílias, evolução e resumo dos filtros.
 *
 * Os parâmetros vêm por query string porque o painel mantém os filtros em
 * estado no cliente (não na URL): o botão passa o estado atual, e a mesma
 * regra de validação da action é aplicada aqui.
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "dashboard.view")) {
      return Response.json({ error: "Seu perfil não tem permissão para exportar esta lista." }, { status: 403 });
    }

    const params = searchParamsRecord(request);
    const family = single(params.familia);
    const parsed = parseWeightSelection({
      granularity: single(params.granularidade),
      anchor: single(params.ancora),
      processCode: single(params.processo),
      productGroupId: family === "sem-familia" ? null : family,
      withoutProductGroup: family === "sem-familia",
      fallbackAnchor: todayISODate(),
    });
    if (!parsed.success) {
      return Response.json({ error: parsed.message }, { status: 400 });
    }

    const { granularity, anchor, processCode, productGroupId, withoutProductGroup } = parsed.selection;
    const client = await createClient();
    const [stats, processes, groups] = await Promise.all([
      getDashboardCompletedWeight(
        client,
        granularity,
        anchor,
        processCode,
        productGroupId,
        withoutProductGroup,
      ),
      getActiveProcesses(client),
      listProductGroupOptions(client),
    ]);

    const columns = weightProcessColumns(processes, stats.processes);
    const selectedProcess = processCode
      ? processes.find((process) => process.code === processCode)
      : undefined;
    const selectedGroup =
      productGroupId === null
        ? undefined
        : groups.find((group) => group.id === productGroupId);

    const labels = {
      process: selectedProcess?.name ?? processCode ?? "Todos os processos",
      family: withoutProductGroup
        ? "Sem família"
        : selectedGroup
          ? `${selectedGroup.familyDescription} (${selectedGroup.familyAbbreviation})`
          : productGroupId === null
            ? "Todas as famílias"
            : `Família #${productGroupId}`,
    };

    return workbookResponseSheets(
      exportFileName("dashboard-peso"),
      dashboardWeightSheets(stats, columns, todayISODate(), labels),
    );
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
