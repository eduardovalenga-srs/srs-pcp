import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
}

const TONES: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "",
  danger: "border-status-late/50",
  warning: "border-status-progress/50",
  success: "border-status-done/50",
};

/** Cartão de indicador do dashboard. */
export function KpiCard({ label, value, hint, icon, tone = "default" }: KpiCardProps) {
  return (
    <div className={cn("rounded border bg-card px-4 py-3", TONES[tone])}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
