import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { searchParamsRecord } from "@/lib/export/common";
import { getChildItemsKitOverdueTotals } from "@/lib/repositories/order-items.repository";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { createClient } from "@/lib/supabase/server";
import { todayISODate } from "@/lib/utils/dates";
import { parseChildItemFilters } from "@/lib/utils/filters";
import { errorMessage } from "@/lib/utils/supabase-result";

/** Resumo do card Atrasados da Fábrica 1 — executado somente sob demanda. */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "orders.view")) {
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

    const totals = await getChildItemsKitOverdueTotals(
      client,
      { ...filters, overdue: false },
      processId,
      todayISODate(),
    );
    return Response.json(totals);
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível carregar os atrasados da Fábrica 1.") },
      { status: 500 },
    );
  }
}
