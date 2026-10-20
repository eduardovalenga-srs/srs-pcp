/**
 * Varredura de listas paginadas do servidor — usada quando é preciso o
 * conjunto FILTRADO INTEIRO (não só a página visível da tela):
 *
 *  - a exportação .xlsx (espelha a lista inteira);
 *  - o card "Atrasados" da Fábrica 1 (regra do KIT), que soma todas as páginas do
 *    filtro atual antes de comparar a data da coluna KIT com hoje.
 *
 * Mora em `lib/utils` (e não em `lib/export`) porque não é exclusivo da
 * exportação: `lib/export/common.ts` re-exporta os dois símbolos para os
 * endpoints continuarem importando do mesmo lugar.
 */

/**
 * Tamanho de página da varredura. Igual ao maior `porpagina` da UI
 * (MAX_PAGE_SIZE): as RPCs não têm teto no banco, mas a resposta HTTP do
 * Supabase é limitada (1000 linhas por requisição) — pedir mais viraria
 * truncate silencioso.
 */
export const EXPORT_PAGE_SIZE = 1000;

/**
 * Teto de páginas por varredura (100k linhas) — rede de segurança contra
 * um loop infinito caso a RPC devolva sempre a página cheia.
 */
const MAX_PAGES = 100;

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
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { rows, total } = await fetchPage(page);
    collected.push(...rows);
    if (rows.length === 0 || rows.length < EXPORT_PAGE_SIZE || collected.length >= total) {
      break;
    }
  }
  return collected;
}
