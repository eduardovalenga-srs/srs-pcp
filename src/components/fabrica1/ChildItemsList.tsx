import Link from "next/link";

import { MATERIAL_UNIT_LABELS, type MaterialUnit } from "@/lib/constants/materials";
import { PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS } from "@/lib/constants/production";
import type { ChildItemWithMaterials } from "@/lib/types/order";
import { formatDate } from "@/lib/utils/dates";
import { calculateTotalWeight, formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { fabrica1ItemProcesses } from "@/lib/utils/production";
import { Badge } from "@/components/ui/badge";

function unitLabel(unit: string): string {
  return MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
}

/** Rótulo do peso total do item: quantidade × peso unitário (sem estimativa). */
function totalWeightLabel(quantity: number, unitWeightKg: number | null): string {
  const total = calculateTotalWeight(quantity, unitWeightKg);
  return total === null ? "—" : `${formatWeight(total)} kg`;
}

/**
 * Processos do item filho na Fábrica 1: MP primeiro, depois os aplicáveis em
 * ordem fabril até o KIT — o que vem depois do KIT fica oculto. Código +
 * símbolo da situação; nunca só cor (símbolo + sr-only).
 */
function ProcessList({ item }: { item: ChildItemWithMaterials }) {
  const processes = fabrica1ItemProcesses(item.processes);
  if (processes.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum processo aplicável.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {processes.map((process) => (
        <li key={process.code}>
          <span
            className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] tabular-nums"
            title={`${process.name} — ${PROCESS_STATUS_LABELS[process.status]}`}
          >
            <span aria-hidden>{PROCESS_STATUS_SYMBOLS[process.status]}</span>
            {process.code}
            <span className="sr-only">{PROCESS_STATUS_LABELS[process.status]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Materiais de um item filho — filho sem material fica sinalizado (pendência de compra). */
function MaterialsList({ item }: { item: ChildItemWithMaterials }) {
  if (item.materials.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum material cadastrado.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {item.materials.map((material) => (
        <li key={material.id} className="text-xs">
          <span className="font-medium">{material.description}</span>{" "}
          <span className="tabular-nums text-muted-foreground">
            {formatQuantity(material.quantity)} {unitLabel(material.unit)}
          </span>
          {material.notes ? (
            <span className="block text-[11px] text-muted-foreground">{material.notes}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Item pai: badge do código + descrição — o conteúdo mora na coluna "Item pai". */
function ParentCell({ item }: { item: ChildItemWithMaterials }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {item.parentItem ? (
        <Badge variant="outline" className="px-1 py-0 tabular-nums">
          {item.parentItem}
        </Badge>
      ) : null}
      <span
        className="min-w-0 max-w-[200px] truncate text-sm"
        title={item.parentDescription ?? undefined}
      >
        {item.parentDescription ?? <span className="text-muted-foreground">—</span>}
      </span>
    </span>
  );
}

interface ChildItemsListProps {
  items: ChildItemWithMaterials[];
}

/**
 * Lista de itens filhos com matérias-primas (tela Fábrica 1).
 * Server component puro: sem interatividade por linha — só links — para
 * não jogar custo de hidratação em cada item.
 */
export function ChildItemsList({ items }: ChildItemsListProps) {
  return (
    <>
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Itens filhos das OFs com item pai, quantidades, pesos, entrega, processos e
            matérias-primas.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">OF/OS</th>
              <th scope="col" className="px-3 py-2 font-semibold">Item pai</th>
              <th scope="col" className="px-3 py-2 font-semibold">Filho</th>
              <th scope="col" className="px-3 py-2 font-semibold">Matérias-primas</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Qtd.</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Peso un.</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Peso total</th>
              <th scope="col" className="px-3 py-2 font-semibold">Entrega</th>
              <th scope="col" className="px-3 py-2 font-semibold">Processos</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b align-top last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    href={`/pedidos/${item.orderId}`}
                    className="font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
                    title={item.customerName ?? undefined}
                  >
                    {item.orderCode}
                  </Link>
                  {item.customerName ? (
                    <span className="block max-w-[160px] truncate text-xs text-muted-foreground">
                      {item.customerName}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <ParentCell item={item} />
                </td>
                <td className="px-3 py-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {item.childItem ? (
                      <Badge variant="secondary" className="px-1 py-0 tabular-nums">
                        {item.childItem}
                      </Badge>
                    ) : null}
                    <span className="min-w-0 max-w-[220px] truncate text-sm" title={item.description}>
                      {item.description}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <MaterialsList item={item} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {item.unitWeightKg === null ? (
                    "—"
                  ) : (
                    <>
                      {formatWeight(item.unitWeightKg)}
                      <span className="text-muted-foreground"> kg</span>
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {totalWeightLabel(item.quantity, item.unitWeightKg)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatDate(item.deliveryDate)}
                </td>
                <td className="px-3 py-2">
                  <ProcessList item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {items.map((item) => (
          <li key={item.id} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                <Link
                  href={`/pedidos/${item.orderId}`}
                  className="font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
                >
                  {item.orderCode}
                </Link>
                {item.parentItem ? (
                  <Badge variant="outline" className="px-1 py-0 tabular-nums">
                    {item.parentItem}
                  </Badge>
                ) : null}
                {item.childItem ? (
                  <Badge variant="secondary" className="px-1 py-0 tabular-nums">
                    {item.childItem}
                  </Badge>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {formatDate(item.deliveryDate)}
              </span>
            </header>

            <p className="mt-1 text-sm">{item.description}</p>
            {item.parentDescription ? (
              <p
                className="truncate text-xs text-muted-foreground"
                title={item.parentDescription}
              >
                Item pai: {item.parentDescription}
              </p>
            ) : null}
            {item.customerName ? (
              <p className="truncate text-xs text-muted-foreground">{item.customerName}</p>
            ) : null}

            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline">Qtd.: </dt>
                <dd className="inline tabular-nums text-foreground">{formatQuantity(item.quantity)}</dd>
              </div>
              <div>
                <dt className="inline">Peso un.: </dt>
                <dd className="inline tabular-nums text-foreground">
                  {item.unitWeightKg === null ? "—" : `${formatWeight(item.unitWeightKg)} kg`}
                </dd>
              </div>
              <div>
                <dt className="inline">Peso total: </dt>
                <dd className="inline tabular-nums text-foreground">
                  {totalWeightLabel(item.quantity, item.unitWeightKg)}
                </dd>
              </div>
            </dl>

            <div className="mt-2 border-t pt-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Matérias-primas
              </h4>
              <div className="mt-1">
                <MaterialsList item={item} />
              </div>
            </div>

            <div className="mt-2 border-t pt-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Processos</h4>
              <div className="mt-1">
                <ProcessList item={item} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
