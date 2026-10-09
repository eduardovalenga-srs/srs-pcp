import type { OrderStatus } from "@/lib/constants/orders";
import { ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";
import { PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS, PROCESS_STATUS_VARIANTS } from "@/lib/constants/production";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ORDER_STATUS_VARIANTS: Record<OrderStatus, BadgeProps["variant"]> = {
  PLANEJADO: "muted",
  EM_PRODUCAO: "warning",
  CONCLUIDO: "success",
  CANCELADO: "destructive",
};

/** Situação do pedido/item (nunca distinguida apenas por cor). */
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge variant={ORDER_STATUS_VARIANTS[status]} className={className}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

interface ProcessStatusBadgeProps {
  status: ProcessStatus;
  showLabel?: boolean;
  className?: string;
}

/** Situação de um processo: símbolo + texto (acessível sem cor). */
export function ProcessStatusBadge({ status, showLabel = true, className }: ProcessStatusBadgeProps) {
  return (
    <Badge variant={PROCESS_STATUS_VARIANTS[status]} className={cn(className)}>
      <span aria-hidden>{PROCESS_STATUS_SYMBOLS[status]}</span>
      <span className="sr-only">{PROCESS_STATUS_LABELS[status]}</span>
      {showLabel ? PROCESS_STATUS_LABELS[status] : null}
    </Badge>
  );
}
