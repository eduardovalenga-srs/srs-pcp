import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Hammer,
  Package,
  Truck,
} from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/services/production.service";
import { getDashboardOrders } from "@/lib/repositories/orders.repository";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Header } from "@/components/layout/Header";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ProcessLoadTable } from "@/components/dashboard/ProcessLoadTable";

export const metadata = { title: "Dashboard" };

const DELIVERY_WINDOWS = [
  { key: "OVERDUE", label: "Atrasados", field: "overdue" as const },
  { key: "TODAY", label: "Entrega hoje", field: "today" as const },
  { key: "NEXT_7_DAYS", label: "Próx. 7 dias", field: "next7" as const },
  { key: "NEXT_30_DAYS", label: "Próx. 30 dias", field: "next30" as const },
];

/** Faixas de envelhecimento — a contagem vem do banco (get_dashboard_orders). */
const AGING_BUCKETS = [
  { key: "0-7", label: "0 a 7 dias" },
  { key: "8-15", label: "8 a 15 dias" },
  { key: "16-30", label: "16 a 30 dias" },
  { key: "31-60", label: "31 a 60 dias" },
  { key: "60+", label: "Mais de 60 dias" },
];

export default async function DashboardPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "dashboard.view")) {
    return (
      <>
        <Header title="Dashboard" description="Indicadores da produção." />
        <AccessDenied />
      </>
    );
  }

  let stats: Awaited<ReturnType<typeof getDashboardData>>;
  let orders: Awaited<ReturnType<typeof getDashboardOrders>>;
  try {
    const client = await createClient();
    [stats, orders] = await Promise.all([getDashboardData(client), getDashboardOrders(client)]);
  } catch (error) {
    return (
      <>
        <Header title="Dashboard" description="Indicadores da produção." />
        <ErrorState
          title="Não foi possível carregar o dashboard"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const topCustomers = orders.topCustomers;
  const aging = [
    ...AGING_BUCKETS.map((bucket) => ({ ...bucket, count: orders.aging[bucket.key] ?? 0 })),
    ...(orders.aging["sem-data"]
      ? [{ key: "sem-data", label: "Sem data de pedido", count: orders.aging["sem-data"] }]
      : []),
  ];
  const agingTotal = aging.reduce((sum, bucket) => sum + bucket.count, 0);
  const agingMax = Math.max(1, ...aging.map((bucket) => bucket.count));

  return (
    <>
      <Header
        title="Dashboard"
        description="Panorama geral dos pedidos, entregas e carga dos processos."
      />

      <div className="space-y-4">
        <section aria-label="Indicadores gerais" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Pedidos"
            value={stats.totalOrders}
            icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />}
            hint={`${stats.ordersByStatus.EM_PRODUCAO ?? 0} em produção`}
          />
          <KpiCard
            label="Itens"
            value={stats.totalItems}
            icon={<Package className="h-3.5 w-3.5" aria-hidden />}
            hint={`${stats.itemsByStatus.PLANEJADO ?? 0} planejados`}
          />
          <KpiCard
            label="Em produção"
            value={stats.itemsInProduction}
            tone="warning"
            icon={<Hammer className="h-3.5 w-3.5" aria-hidden />}
            hint="Itens em andamento"
          />
          <KpiCard
            label="Concluídos"
            value={stats.itemsDone}
            tone="success"
            icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
          />
          <KpiCard
            label="Atrasados"
            value={stats.itemsOverdue}
            tone="danger"
            icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
            hint="Entrega vencida sem expedição concluída"
          />
        </section>

        <section aria-label="Janelas de entrega" className="rounded border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">Entregas</h2>
            <span className="text-xs text-muted-foreground">clique para filtrar na gestão de OF</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {DELIVERY_WINDOWS.map((window) => (
              <Link
                key={window.key}
                href={`/gestao-entregas?entrega=${window.key}`}
                className="rounded border px-3 py-2 transition-colors hover:bg-accent/50"
              >
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                  {window.label}
                </span>
                <span className="text-lg font-semibold tabular-nums">{stats.delivery[window.field]}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-label="Carga por processo" className="space-y-2">
          <h2 className="text-sm font-semibold">Carga de trabalho por processo</h2>
          <ProcessLoadTable processes={stats.processes} />
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-label="Clientes que mais pedem" className="rounded border bg-card p-3">
            <h2 className="text-sm font-semibold">Clientes que mais pedem</h2>
            {topCustomers.length === 0 ? (
              <EmptyState title="Nenhum pedido cadastrado" />
            ) : (
              <ul className="mt-2 space-y-1.5">
                {topCustomers.map((customer) => (
                  <li key={customer.name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{customer.name}</span>
                    <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                      {customer.count} {customer.count === 1 ? "pedido" : "pedidos"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Envelhecimento de pedidos" className="rounded border bg-card p-3">
            <h2 className="text-sm font-semibold">Envelhecimento de pedidos em aberto</h2>
            {agingTotal === 0 ? (
              <EmptyState title="Nenhum pedido em aberto" description="Todos os pedidos estão concluídos ou cancelados." />
            ) : (
              <ul className="mt-2 space-y-2">
                {aging.map((bucket) => (
                  <li key={bucket.key} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{bucket.label}</span>
                      <span className="tabular-nums font-medium">{bucket.count}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.round((bucket.count / agingMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
