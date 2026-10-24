import type { RomaneioStatus } from "@/lib/constants/romaneio";
import { ROMANEIO_STATUS_LABELS } from "@/lib/constants/romaneio";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ROMANEIO_STATUS_VARIANTS: Record<RomaneioStatus, BadgeProps["variant"]> = {
  SIMULACAO: "warning",
  EMITIDO: "success",
  CANCELADO: "destructive",
};

/** Situação do romaneio (nunca distinguida apenas por cor). */
export function RomaneioStatusBadge({
  status,
  className,
}: {
  status: RomaneioStatus;
  className?: string;
}) {
  return (
    <Badge variant={ROMANEIO_STATUS_VARIANTS[status]} className={cn(className)}>
      {ROMANEIO_STATUS_LABELS[status]}
    </Badge>
  );
}
