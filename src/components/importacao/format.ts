/** Formatação exibida pela tela de importação (pt-BR). */

/** Tamanho do arquivo em B/KB/MB. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;

  const megabytes = kilobytes / 1024;
  return `${megabytes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
