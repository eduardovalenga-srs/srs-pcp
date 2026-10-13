import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getOrder } from "@/lib/services/orders.service";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import type { OrderItemDetails } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import { formatDate } from "@/lib/utils/dates";
import { calculateTotalWeight, formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { OrderStatusBadge } from "@/components/shared/StatusBadges";
import { DeleteOrderButton } from "@/components/pedidos/DeleteOrderButton";
import { ItemProcesses } from "@/components/pedidos/ItemProcesses";
import { OrderDetailMaterials } from "@/components/pedidos/OrderDetailMaterials";

function itemCountsLabel(parentCount: number, childCount: number): string {
  const parents = parentCount === 1 ? "1 item pai" : `${parentCount} itens pais`;
  if (childCount === 0) return parents;
  return `${parents} · ${childCount === 1 ? "1 filho" : `${childCount} filhos`}`;
}

function byCode(left: OrderItemDetails, right: OrderItemDetails): number {
  return (left.parentItem ?? "").localeCompare(right.parentItem ?? "");
}

/**
 * Peso total exibido: usa a coluna gravada (023: derivada de qtd × peso
 * unit. por trigger) com fallback de cálculo para linhas antigas ainda
 * não migradas — o card nunca aparece vazio ("—") quando os dois
 * números existem.
 */
function displayTotalWeight(item: OrderItemDetails): number | null {
  return item.totalWeightKg ?? calculateTotalWeight(item.quantity, item.unitWeightKg);
}

/**
 * Detalhes da OF: dados do pedido, itens pai com seus itens filhos
 * (processos com previsão e necessidade + matéria-prima) e ações de
 * editar/excluir — ponto de entrada a partir da gestão de entregas.
 *
 * A gestão de entregas lista só os itens pai; os filhos aparecem apenas
 * aqui (e podem ser ajustados por reimportação ou pela grade de materiais).
 */
export default async function PedidoDetalhePage({ params }: PageProps<"/pedidos/[id]">) {
  const { id } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const canEdit = can(sessionUser.role, "orders.edit");
  const canDelete = can(sessionUser.role, "orders.delete");
  const productionCapabilities = {
    canUpdateStatus: can(sessionUser.role, "production.update_status"),
    canEditQuantities: can(sessionUser.role, "production.edit"),
    canViewHistory: can(sessionUser.role, "production.view_history"),
    canEditDelivery: canEdit,
  };

  let order: Awaited<ReturnType<typeof getOrder>>;
  let processCatalog: ProcessDefinition[] = [];
  try {
    const client = await createClient();
    // 024: pedido e catálogo em paralelo (catálogo só é usado se o pedido
    // existir, mas o custo é menor que o round-trip sequencial).
    const [loadedOrder, loadedCatalog] = await Promise.all([
      getOrder(client, id),
      getActiveProcesses(client),
    ]);
    order = loadedOrder;
    processCatalog = loadedOrder ? loadedCatalog : [];
  } catch (error) {
    return (
      <>
        <Header title="Detalhes do pedido" description="Dados da OF e de seus itens." />
        <ErrorState
          title="Não foi possível carregar o pedido"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  if (!order) {
    return (
      <>
        <Header title="Detalhes do pedido" description="Dados da OF e de seus itens." />
        <EmptyState
          title="Pedido não encontrado"
          description="Ele pode ter sido excluído. Volte para a gestão de entregas para continuar."
          action={
            <Button type="button" size="sm" asChild>
              <Link href="/gestao-entregas">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Gestão de entregas
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  // Hierarquia: itens raiz (pais) e filhos agrupados pelo vínculo (016).
  const parents = order.items.filter((item) => item.parentItemId === null).sort(byCode);
  const childrenByParent = new Map<string, OrderItemDetails[]>();
  for (const item of order.items) {
    if (!item.parentItemId) continue;
    const list = childrenByParent.get(item.parentItemId) ?? [];
    list.push(item);
    childrenByParent.set(item.parentItemId, list);
  }
  for (const list of childrenByParent.values()) list.sort(byCode);
  const childCount = order.items.length - parents.length;

  const headerDescription = [
    order.customerName,
    order.deliveryDate ? `entrega ${formatDate(order.deliveryDate)}` : "sem data de entrega",
    itemCountsLabel(parents.length, childCount),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Header
        title={`Pedido ${order.code}`}
        description={headerDescription}
        actions={
          <>
            {canEdit ? (
              <Button type="button" size="sm" asChild>
                <Link href={`/pedidos/${order.id}/editar`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  Editar
                </Link>
              </Button>
            ) : null}
            {canDelete ? (
              <DeleteOrderButton
                orderId={order.id}
                orderCode={order.code}
                redirectHref="/gestao-entregas"
              />
            ) : null}
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/gestao-entregas">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Voltar
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Dados do pedido" className="rounded border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Dados do pedido</h2>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Situação</dt>
            <dd>
              <OrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tipo</dt>
            <dd className="font-medium">{order.type}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{order.customerName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Data do pedido</dt>
            <dd className="tabular-nums">{formatDate(order.orderDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Entrega</dt>
            <dd className="tabular-nums">{formatDate(order.deliveryDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Itens</dt>
            <dd className="font-medium">{itemCountsLabel(parents.length, childCount)}</dd>
          </div>
          {order.description ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted-foreground">Descrição</dt>
              <dd>{order.description}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-label="Itens da OF" className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Itens da OF</h2>
          <p className="text-xs text-muted-foreground">
            Cada item pai mostra seus processos (previsão e necessidade) e, abaixo, seus itens
            filhos com os mesmos controles.
          </p>
        </div>

        {parents.length === 0 ? (
          <EmptyState
            title="Nenhum item"
            description="Este pedido ainda não tem itens cadastrados."
            action={
              canEdit ? (
                <Button type="button" size="sm" asChild>
                  <Link href={`/pedidos/${order.id}/editar`}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    Editar pedido
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          parents.map((item) => {
            const children = childrenByParent.get(item.id) ?? [];

            return (
              <Card key={item.id}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {item.parentItem ? (
                      <Badge variant="outline" className="tabular-nums">
                        {item.parentItem}
                      </Badge>
                    ) : null}
                    <CardTitle className="truncate text-sm">{item.description}</CardTitle>
                    {item.family ? (
                      <span className="text-xs text-muted-foreground">TP {item.family}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.op ? (
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        OP {item.op}
                      </span>
                    ) : null}
                    <OrderStatusBadge status={item.status} />
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Família</dt>
                      <dd>{item.family || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Quantidade</dt>
                      <dd className="tabular-nums">{formatQuantity(item.quantity)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Peso un.</dt>
                      <dd className="tabular-nums">{formatWeight(item.unitWeightKg)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Peso total</dt>
                      <dd className="tabular-nums">{formatWeight(displayTotalWeight(item))}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Entrega</dt>
                      <dd className="tabular-nums">{formatDate(item.deliveryDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Ordem de Produção (OP)</dt>
                      <dd className="font-medium tabular-nums">{item.op || "—"}</dd>
                    </div>
                  </dl>

                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                      Processos
                    </h4>
                    <ItemProcesses
                      orderCode={order.code}
                      orderItemId={item.id}
                      itemDescription={item.description}
                      deliveryDate={item.deliveryDate ?? order.deliveryDate}
                      processes={item.processes}
                      catalog={processCatalog}
                      capabilities={productionCapabilities}
                    />
                  </div>

                  <OrderDetailMaterials
                    orderItemId={item.id}
                    materials={item.materials}
                    canEdit={canEdit}
                  />

                  {children.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                        Itens filhos ({children.length})
                      </h4>

                      {children.map((child) => (
                        <div
                          key={child.id}
                          className="space-y-3 rounded border bg-muted/10 p-3"
                          aria-label={`Filho ${child.parentItem ?? child.description}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {child.parentItem ? (
                                <Badge variant="outline" className="tabular-nums">
                                  {child.parentItem}
                                </Badge>
                              ) : null}
                              <span className="truncate text-sm font-medium">
                                {child.description}
                              </span>
                              {child.family ? (
                                <span className="text-xs text-muted-foreground">
                                  TP {child.family}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {child.op ? (
                                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                                  OP {child.op}
                                </span>
                              ) : null}
                              <OrderStatusBadge status={child.status} />
                            </div>
                          </div>

                          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <dt className="text-muted-foreground">Quantidade</dt>
                              <dd className="tabular-nums">{formatQuantity(child.quantity)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Peso un.</dt>
                              <dd className="tabular-nums">{formatWeight(child.unitWeightKg)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Peso total</dt>
                              <dd className="tabular-nums">{formatWeight(displayTotalWeight(child))}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Ordem de Produção (OP)</dt>
                              <dd className="font-medium tabular-nums">{child.op || "—"}</dd>
                            </div>
                          </dl>

                          <div className="space-y-1.5">
                            <h5 className="text-xs font-semibold uppercase text-muted-foreground">
                              Processos
                            </h5>
                            <ItemProcesses
                              orderCode={order.code}
                              orderItemId={child.id}
                              itemDescription={child.description}
                              deliveryDate={child.deliveryDate ?? order.deliveryDate}
                              processes={child.processes}
                              catalog={processCatalog}
                              capabilities={productionCapabilities}
                            />
                          </div>

                          <OrderDetailMaterials
                            orderItemId={child.id}
                            materials={child.materials}
                            canEdit={canEdit}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </>
  );
}
