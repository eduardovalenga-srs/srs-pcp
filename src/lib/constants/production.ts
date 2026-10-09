/** Status possíveis de um processo de produção (nunca apenas booleanos). */
export const PROCESS_STATUSES = [
  "NAO_INICIADO",
  "EM_ANDAMENTO",
  "CONCLUIDO",
  "BLOQUEADO",
  "NAO_APLICAVEL",
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const PROCESS_STATUS_LABELS: Record<ProcessStatus, string> = {
  NAO_INICIADO: "Não iniciado",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDO: "Concluído",
  BLOQUEADO: "Bloqueado",
  NAO_APLICAVEL: "Não aplicável",
};

/**
 * Representação textual de cada status.
 * A célula exibe símbolo + ícone + aria-label (nunca apenas cor).
 */
export const PROCESS_STATUS_SYMBOLS: Record<ProcessStatus, string> = {
  CONCLUIDO: "✓",
  EM_ANDAMENTO: "●",
  BLOQUEADO: "!",
  NAO_INICIADO: "○",
  NAO_APLICAVEL: "—",
};

export const PROCESS_STATUS_VARIANTS: Record<
  ProcessStatus,
  "success" | "warning" | "destructive" | "muted" | "outline"
> = {
  CONCLUIDO: "success",
  EM_ANDAMENTO: "warning",
  BLOQUEADO: "destructive",
  NAO_INICIADO: "muted",
  NAO_APLICAVEL: "outline",
};

export function isProcessStatus(value: string): value is ProcessStatus {
  return (PROCESS_STATUSES as readonly string[]).includes(value);
}
