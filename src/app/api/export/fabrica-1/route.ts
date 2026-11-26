
import { getSessionUser } from "@/lib/auth/session";
import { fabrica1Sheet } from "@/lib/export/columns";
import { EXPORT_PAGE_SIZE, collectAllPages, exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponse } from "@/lib/export/workbook";
import { listChildItemGroups } from "@/lib/repositories/order-items.repository";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { getScheduleIndex } from "@/lib/services/scheduling.service";
import { createClient } from "@/lib/supabase/server";
import { todayISODate } from "@/lib/utils/dates";
import { DEFAULT_CHILD_ITEM_SORT, parseChildItemFilters } from "@/lib/utils/filters";
import { errorMessage } from "@/lib/utils/supabase-result";
import { hasPermission } from "@/lib/auth/access";
import { getOrderFamilyAbbreviations } from "@/lib/repositories/orders.repository";
import { filterAndSortByOrderFamily } from "@/lib/utils/order-family";

/**
 * GET /api/export/fabrica-1 — .xlsx da lista filtrada INTEIRA da Fábrica 1
 * (todos os grupos, todas as páginas), nas mesmas colunas da tela — cadeia
 * F1 com MP primeiro, materiais consolidados na célula.
 *
 * Mesmos filtros da URL e mesma permissão da página (`orders.view`). O
 * `processCode` é resolvido para o id antes da consulta, exatamente como
 * `getChildItemsPage` faz na página.
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!hasPermission(user.access, "menu.fabrica1")) {
      return Response.json({ error: "Seu perfil não tem permissão para exportar esta lista." }, { status: 403 });
    }

    const filters = parseChildItemFilters(searchParamsRecord(request));
    const client = await createClient();

    const [processes, schedule] = await Promise.all([
      getActiveProcesses(client),
      getScheduleIndex(client),
    ]);
    const processId =
      filters.processCode === "ALL"
        ? null
        : (processes.find((process) => process.code === filters.processCode)?.id ?? null);

    const today = todayISODate();
    const familySort = filters.sort === "product_family";
    const allGroups =
      filters.processCode !== "ALL" && processId === null
        ? []
        : await collectAllPages((page) =>
            listChildItemGroups(
              client,
              {
                ...filters,
                orderFamilyAbbreviation: "",
                sort: familySort ? DEFAULT_CHILD_ITEM_SORT : filters.sort,
                page,
                pageSize: EXPORT_PAGE_SIZE,
              },
              processId,
              today,
              schedule,
            ).then((result) => ({ rows: result.items, total: result.total })),
          );
    const familyAbbreviations =
      filters.orderFamilyAbbreviation || familySort
        ? await getOrderFamilyAbbreviations(client, allGroups.map((item) => item.orderId))
        : new Map<string, string>();
    const groups = filterAndSortByOrderFamily(
      allGroups.map((item) => ({
        ...item,
        ...(familyAbbreviations.has(item.orderId)
          ? { orderFamilyAbbreviation: familyAbbreviations.get(item.orderId) }
          : {}),
      })),
      filters.orderFamilyAbbreviation,
      filters.sortDir,
      familySort,
    );
    return workbookResponse(exportFileName("fabrica-1"), fabrica1Sheet(groups, processes, schedule));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
