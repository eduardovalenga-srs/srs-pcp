import { todayISODate } from "@/lib/utils/dates";
import type { SearchParamsRecord } from "@/lib/utils/filters";

/**
 * Base comum da exportação de listas (.xlsx).
 *
 * A exportação espelha a lista FILTRADA INTEIRA da tela — não só a página
 * visível. Para isso as consultas são paginadas com `collectAllPages`, no
 * mesmo formato das telas (a varredura em si mora em
 * `lib/utils/collect-pages.ts`, compartilhada com o card de atrasados da
 * Fábrica 1) e é re-exportada aqui para os endpoints não mudarem de import.
 */
export { EXPORT_PAGE_SIZE, collectAllPages } from "@/lib/utils/collect-pages";

/** Query string da requisição no formato que os `parse*Filters` aceitam. */
export function searchParamsRecord(request: Request): SearchParamsRecord {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

/** Nome do arquivo: `export-<tela>_<AAAA-MM-DD>.xlsx`. */
export function exportFileName(screen: string): string {
  return `export-${screen}_${todayISODate()}.xlsx`;
}
