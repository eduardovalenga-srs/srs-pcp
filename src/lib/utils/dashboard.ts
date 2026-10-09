import { differenceInCalendarDays, parseISO } from "date-fns";

import type { OrderStatus } from "@/lib/constants/orders";
import { parseISODateToLocal } from "@/lib/utils/dates";

/** Faixas de envelhecimento de pedidos em aberto. */
export interface AgingBucket {
  key: string;
  label: string;
  count: number;
}

export const AGING_BUCKETS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: "0-7", label: "0 a 7 dias", min: 0, max: 7 },
  { key: "8-15", label: "8 a 15 dias", min: 8, max: 15 },
  { key: "16-30", label: "16 a 30 dias", min: 16, max: 30 },
  { key: "31-60", label: "31 a 60 dias", min: 31, max: 60 },
  { key: "60+", label: "Mais de 60 dias", min: 61, max: null },
];

export const OPEN_ORDER_STATUSES: OrderStatus[] = ["PLANEJADO", "EM_PRODUCAO"];

export interface CustomerRow {
  customerName: string | null;
}

export interface AgingRow {
  orderDate: string | null;
  status: OrderStatus;
}

/** Top clientes pela quantidade de pedidos (empates ordenados por nome). */
export function computeTopCustomers(rows: CustomerRow[], limit = 5): { name: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const name = (row.customerName ?? "").trim();
    const key = name === "" ? "Sem cliente" : name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, limit);
}

/**
 * Envelhecimento dos pedidos em aberto (PLANEJADO/EM_PRODUCAO),
 * medido em dias corridos entre a data do pedido e "hoje".
 */
export function computeOrderAging(rows: AgingRow[], today: string): AgingBucket[] {
  const todayDate = parseISODateToLocal(today) ?? parseISO(today);
  const buckets = AGING_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, count: 0 }));
  let withoutDate = 0;

  for (const row of rows) {
    if (!OPEN_ORDER_STATUSES.includes(row.status)) continue;
    if (!row.orderDate) {
      withoutDate += 1;
      continue;
    }
    const orderDate = parseISODateToLocal(row.orderDate);
    if (!orderDate) {
      withoutDate += 1;
      continue;
    }

    const age = differenceInCalendarDays(todayDate, orderDate);
    const index = AGING_BUCKETS.findIndex(
      (bucket) => age >= bucket.min && (bucket.max === null || age <= bucket.max),
    );
    const target = index >= 0 ? index : AGING_BUCKETS.length - 1;
    buckets[target].count += 1;
  }

  if (withoutDate > 0) {
    buckets.push({ key: "sem-data", label: "Sem data de pedido", count: withoutDate });
  }

  return buckets;
}
