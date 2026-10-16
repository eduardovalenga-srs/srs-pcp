import { cn } from "@/lib/utils";
import type { FamilyTotal } from "@/lib/types/production";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";

interface FamilyTotalsListProps {
  /** Lista vinda da RPC (035) — já ordenada por qtd. desc no banco. */
  entries: FamilyTotal[];
  className?: string;
}

/**
 * Lista "Famílias" dos cards de resumo (035): cada família (coluna TP) do
 * conjunto filtrado com quantidade e peso, na ordem do banco. Família
 * vazia vira "—"; lista vazia também exibe "—".
 */
export function FamilyTotalsList({ entries, className }: FamilyTotalsListProps) {
  return (
    <div className={cn("border-t pt-1.5", className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Famílias
      </span>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {entries.length === 0 ? (
          <li className="text-muted-foreground">—</li>
        ) : (
          entries.map((entry) => (
            <li key={entry.family ?? "—"} className="tabular-nums">
              <span className="font-medium">{entry.family ?? "—"}</span>{" "}
              <span className="text-muted-foreground">
                {formatQuantity(entry.qty)} un · {formatWeight(entry.weight)} kg
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
