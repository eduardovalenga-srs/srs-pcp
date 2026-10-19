import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { pedidosSheet } from "@/lib/export/columns";
import { EXPORT_PAGE_SIZE, collectAllPages, exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponse } from "@/lib/export/workbook";
import { listOrders } from "@/lib/repositories/orders.repository";
import { getOrdersProposal } from "@/lib/services/orders.service";
import { createClient } from "@/lib/supabase/server";
import { parseOrderFilters } from "@/lib/utils/filters";
import { errorMessage } from "@/lib/utils/supabase-result";

/**
 * GET /api/export/pedidos — .xlsx da lista filtrada INTEIRA de pedidos
 * (todas as páginas), nas mesmas colunas da tela e na mesma ordem fixa do
 * servidor (entrega, depois código).
 *
 * Mesmos filtros da URL e mesma permissão da página (`orders.view`).
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "orders.view")) {
      return Response.json({ error: "Seu perfil não tem permissão para exportar esta lista." }, { status: 403 });
    }

    const filters = parseOrderFilters(searchParamsRecord(request));
    const client = await createClient();

    const orders = await collectAllPages((page) =>
      listOrders(client, { ...filters, page, pageSize: EXPORT_PAGE_SIZE }).then((result) => ({
        rows: result.orders,
        total: result.total,
      })),
    );

    // Data de proposta (DP) calculada com a MESMA regra da página — o
    // servidor agrega os processos do conjunto inteiro exportado.
    const proposalByOrder = await getOrdersProposal(
      client,
      orders.map((order) => order.id),
    );

    return workbookResponse(exportFileName("pedidos"), pedidosSheet(orders, proposalByOrder));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
