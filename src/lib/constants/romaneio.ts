/** Status de um romaneio de expedição. */
export const ROMANEIO_STATUSES = ["ABERTO", "CONFERIDO", "CONFIRMADO", "CANCELADO"] as const;
export type RomaneioStatus = (typeof ROMANEIO_STATUSES)[number];

export const ROMANEIO_STATUS_LABELS: Record<RomaneioStatus, string> = {
  ABERTO: "Aberto",
  CONFERIDO: "Conferido",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
};
