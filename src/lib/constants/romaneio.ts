/** Status de um romaneio de expedição. */
export const ROMANEIO_STATUSES = ["SIMULACAO", "EMITIDO", "CANCELADO"] as const;
export type RomaneioStatus = (typeof ROMANEIO_STATUSES)[number];

export const ROMANEIO_STATUS_LABELS: Record<RomaneioStatus, string> = {
  SIMULACAO: "Simulação",
  EMITIDO: "Emitido",
  CANCELADO: "Cancelado",
};
