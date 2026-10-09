import type { ProcessStat } from "@/lib/types/production";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";

interface ProcessLoadTableProps {
  processes: ProcessStat[];
}

/**
 * Carga de trabalho por processo: onde o chão de fábrica está parado.
 * O maior volume de bloqueios é sinalizado como gargalo.
 */
export function ProcessLoadTable({ processes }: ProcessLoadTableProps) {
  if (processes.length === 0) {
    return <EmptyState title="Sem dados de processos" description="Importe ou cadastre pedidos para ver a carga." />;
  }

  const bottleneckCode = processes.reduce((worst, current) => {
    if (!worst) return current;
    const worstLoad = worst.blocked * 2 + worst.pending;
    const currentLoad = current.blocked * 2 + current.pending;
    return currentLoad > worstLoad ? current : worst;
  }, processes[0]);

  const totalBlocked = processes.reduce((sum, process) => sum + process.blocked, 0);

  return (
    <div className="overflow-x-auto rounded border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Carga de trabalho por processo do fluxo fabril</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-semibold">Processo</th>
            <th scope="col" className="px-3 py-2 font-semibold">Progresso</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Não iniciado</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Em andamento</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Bloqueado</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Concluído</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => {
            const percent = process.total > 0 ? Math.round((process.done / process.total) * 100) : 0;
            const isBottleneck = process.code === bottleneckCode.code && totalBlocked > 0;
            return (
              <tr key={process.code} className="border-b last:border-0 hover:bg-muted/30">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <span className="inline-flex items-center gap-2">
                    {process.name}
                    <span className="text-xs font-normal text-muted-foreground">{process.code}</span>
                    {isBottleneck ? (
                      <span className="rounded border border-status-late/50 bg-status-late-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-status-late">
                        Gargalo
                      </span>
                    ) : null}
                  </span>
                </th>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-32 overflow-hidden rounded bg-muted"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${process.name}: ${percent}% concluído`}
                    >
                      <div
                        className={cn("h-full bg-status-done", process.blocked > 0 && "bg-status-progress")}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{process.total}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{process.pending}</td>
                <td className="px-3 py-2 text-right tabular-nums text-status-progress">{process.inProgress}</td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums text-muted-foreground",
                    process.blocked > 0 && "font-semibold text-status-blocked",
                  )}
                >
                  {process.blocked}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-status-done">{process.done}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
