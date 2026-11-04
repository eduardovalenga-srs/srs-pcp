/** Status possíveis de um processo de produção (nunca apenas booleanos). */
export const PROCESS_STATUSES = [
  "NAO_INICIADO",
  "CONCLUIDO",
  "NAO_APLICAVEL",
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const PROCESS_STATUS_LABELS: Record<ProcessStatus, string> = {
  NAO_INICIADO: "Não iniciado",
  CONCLUIDO: "Concluído",
  NAO_APLICAVEL: "Não aplicável",
};

/**
 * Representação textual de cada status.
 * A célula exibe símbolo + ícone + aria-label (nunca apenas cor).
 */
export const PROCESS_STATUS_SYMBOLS: Record<ProcessStatus, string> = {
  CONCLUIDO: "✓",
  NAO_INICIADO: "○",
  NAO_APLICAVEL: "—",
};

export const PROCESS_STATUS_VARIANTS: Record<ProcessStatus, "success" | "muted" | "outline"> = {
  CONCLUIDO: "success",
  NAO_INICIADO: "muted",
  NAO_APLICAVEL: "outline",
};

/**
 * Opções da lista de SITUAÇÃO dos filtros de processo da Fábrica 2 (051):
 * "Todas" + a opção **Atrasados** + as situações com símbolo. Os três filtros
 * da tela — coluna, grupo "PROCESSOS" e barra mobile — exibem a MESMA lista,
 * então o rótulo sai de um único lugar.
 */
export function processStatusFilterOptions(): { value: string; label: string }[] {
  return [
    { value: "ALL", label: "Todas as situações" },
    { value: PROCESS_OVERDUE_OPTION, label: `${PROCESS_OVERDUE_SYMBOL} ${PROCESS_OVERDUE_LABEL}` },
    ...PROCESS_STATUSES.map((status) => ({
      value: status,
      label: `${PROCESS_STATUS_SYMBOLS[status]} ${PROCESS_STATUS_LABELS[status]}`,
    })),
  ];
}

export function isProcessStatus(value: string): value is ProcessStatus {
  return (PROCESS_STATUSES as readonly string[]).includes(value);
}

/**
 * Opção "Atrasados" dos filtros de PROCESSO da Fábrica 2 — valor de UI, NUNCA
 * um status do banco (a RPC não conhece "ATRASADO"): o estado mora na flag
 * `processOverdue` dos filtros e o recorte é feito em memória no serviço.
 *
 * `PROCESS_OVERDUE_OPTION` é o valor enviado na URL/estado; rótulo e símbolo
 * seguem o par das situações (`✓/○/—`) para os três filtros da tela
 * (coluna, grupo e barra mobile) falarem igual.
 */
export const PROCESS_OVERDUE_OPTION = "ATRASADO";
export const PROCESS_OVERDUE_SYMBOL = "⚠";
export const PROCESS_OVERDUE_LABEL = "Atrasados";
