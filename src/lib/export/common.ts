import { todayISODate } from "@/lib/utils/dates";
import type { SearchParamsRecord } from "@/lib/utils/filters";

/**
 * Base comum da exportação de listas (.xlsx).
 *
 * A exportação espelha a lista FILTRADA INTEIRA da tela — não só a página
 * visível. Para isso as consultas são paginadas com `collectAllPages`, no
 * mesmo formato das telas.
 */

/**
 * Tamanho de página da exportação. Igual ao maior `porpagina` da UI
 * (MAX_PAGE_SIZE): as RPCs não têm teto no banco, mas a resposta HTTP do
 * Supabase é limitada (1000 linhas por requisição) — pedir mais viraria
 * truncate silencioso.
 */
export const EXPORT_PAGE_SIZE = 1000;

/**
 * Teto de páginas por exportação (100k linhas) — rede de segurança contra
 * um loop infinito caso a RPC devolva sempre a página cheia.
 */
const EXPORT_MAX_PAGES = 100;

/**
 * Varre uma lista paginada do servidor até o fim, acumulando as linhas.
 *
 * `fetchPage` devolve `{ rows, total }` (mesmo shape dos repositórios);
 * a parada acontece quando a página veio incompleta (fim da lista), não há
 * linhas ou o acumulado alcança o total do filtro.
 */
export async function collectAllPages<T>(
  fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const collected: T[] = [];
  for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
    const { rows, total } = await fetchPage(page);
    collected.push(...rows);
    if (rows.length === 0 || rows.length < EXPORT_PAGE_SIZE || collected.length >= total) {
      break;
    }
  }
  return collected;
}

/** Query string da requisição no formato que os `parse*Filters` aceitam. */
export function searchParamsRecord(request: Request): SearchParamsRecord {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

/** Nome do arquivo: `export-<tela>_<AAAA-MM-DD>.xlsx`. */
export function exportFileName(screen: string): string {
  return `export-${screen}_${todayISODate()}.xlsx`;
}
