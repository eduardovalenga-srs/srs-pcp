
import { getSessionUser } from "@/lib/auth/session";
import { searchParamsRecord } from "@/lib/export/common";
import { getChildItemsKitOverdueTotals, listChildItemGroups } from "@/lib/repositories/order-items.repository";
import { getOrderFamilyAbbreviations } from "@/lib/repositories/orders.repository";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { getScheduleIndex } from "@/lib/services/scheduling.service";
import { createClient } from "@/lib/supabase/server";
import { todayISODate } from "@/lib/utils/dates";
import { DEFAULT_CHILD_ITEM_SORT, parseChildItemFilters } from "@/lib/utils/filters";
import { EXPORT_PAGE_SIZE, collectAllPages } from "@/lib/utils/collect-pages";
import { filterAndSortByOrderFamily } from "@/lib/utils/order-family";
import { summarizeKitOverdue } from "@/lib/utils/child-item-groups";
import { errorMessage } from "@/lib/utils/supabase-result";
import { hasPermission } from "@/lib/auth/access";

/** Resumo do card Atrasados da Fábrica 1 — executado somente sob demanda. */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!hasPermission(user.access, "menu.fabrica1")) {
      return Response.json({ error: "Seu perfil não tem permissão para ver esta lista." }, { status: 403 });
    }

    const filters = parseChildItemFilters(searchParamsRecord(request));
    const client = await createClient();
    const processes = await getActiveProcesses(client);
    const processId =
      filters.processCode === "ALL"
        ? null
        : (processes.find((process) => process.code === filters.processCode)?.id ?? null);

    if (filters.processCode !== "ALL" && processId === null) {
      return Response.json({ records: 0, qty: 0, weight: 0 });
    }

    const schedule = await getScheduleIndex(client);
    const today = todayISODate();
    const totals = filters.orderFamilyAbbreviation
      ? await (async () => {
          const groups = await collectAllPages((page) =>
            listChildItemGroups(
              client,
              {
                ...filters,
                overdue: false,
                orderFamilyAbbreviation: "",
                sort: filters.sort === "product_family" ? DEFAULT_CHILD_ITEM_SORT : filters.sort,
                page,
                pageSize: EXPORT_PAGE_SIZE,
              },
              processId,
              today,
              schedule,
            ).then((result) => ({ rows: result.items, total: result.total })),
          );
          const familyAbbreviations = await getOrderFamilyAbbreviations(
            client,
            groups.map((group) => group.orderId),
          );
          const filteredGroups = filterAndSortByOrderFamily(
            groups.map((group) => ({
              ...group,
              ...(familyAbbreviations.has(group.orderId)
                ? { orderFamilyAbbreviation: familyAbbreviations.get(group.orderId) }
                : {}),
            })),
            filters.orderFamilyAbbreviation,
            filters.sortDir,
            false,
          );
          return summarizeKitOverdue(filteredGroups, schedule, today);
        })()
      : await getChildItemsKitOverdueTotals(
          client,
          { ...filters, overdue: false },
          processId,
          today,
          schedule,
        );
    return Response.json(totals);
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível carregar os atrasados da Fábrica 1.") },
      { status: 500 },
    );
  }
}
