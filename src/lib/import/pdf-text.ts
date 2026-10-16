import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extração server-side de texto do PDF da A1 Engenharia (Ordem de
 * Fabricação), usando pdf.js.
 *
 * O objetivo é devolver LINHAS de texto (itens unidos por coordenadas),
 * que o parser `of-pdf.ts` interpreta por regex. A extração preserva o
 * acento correto (ToUnicode do pdf.js) e ignora a matriz `cm` — pegamos
 * o espaço final da página, que já vem transformado.
 */

export interface PdfTextItem {
  str: string;
  /** Posição X do item (esquerda, no espaço da página). */
  x: number;
  /** Posição Y do item (maior = mais perto do topo). */
  y: number;
}

export interface PdfPageText {
  /** Número da página (1-based). */
  page: number;
  /** Itens de texto com coordenadas, ordenados por Y desc e X asc. */
  items: PdfTextItem[];
}

/**
 * Carrega o PDF e devolve os itens de texto de todas as páginas com
 * coordenadas. Lança erro amigável quando o arquivo não é um PDF legível.
 *
 * Só texto: sem renderização, sem canvas, sem worker real (fake worker
 * do pdf.js em Node). Números/vetores de página são ignorados.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<PdfPageText[]> {
  // O destroy correto no pdf.js 6.x é do loadingTask (PDFDocumentProxy
  // não expõe destroy nesta versão).
  const task = getDocument({
    data: new Uint8Array(buffer),
    // Extração de texto não precisa de fontes do sistema.
    useSystemFonts: false,
    // Silencia avisos de standardFontDataUrl (não usamos renderização).
    verbosity: 0,
  });

  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (error) {
    // Causa raiz no log da Vercel (runtime, ESM, canvas, arquivo corrompido...);
    // o pdf.js silencia o próprio logger com `verbosity: 0`, então sem este
    // console.error a causa real nunca alcança o log. Mensagem amigável intacta.
    console.error("[pdf-text] extractPdfText: falha ao carregar o PDF", error);
    throw new Error(
      "O arquivo enviado não é um PDF legível. Baixe o PDF da A1 Engenharia e tente novamente.",
    );
  }

  try {
    const pages: PdfPageText[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      const seen = new Set<string>();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue; // TextMarkedContent (sem texto)
        const str = raw.str.trim();
        if (!str) continue;

        // Dedupe defensivo (o pdf.js pode repetir itens em fontes com kerning).
        const key = `${raw.transform[4]}|${raw.transform[5]}|${str}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({ str, x: raw.transform[4], y: raw.transform[5] });
      }

      items.sort((a, b) => b.y - a.y || a.x - b.x);
      pages.push({ page: pageNumber, items });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

export interface PdfRow {
  /** Número da página (1-based). */
  page: number;
  /** Y do agrupamento (maior = topo). */
  y: number;
  /** Texto da linha (itens unidos por espaço). */
  text: string;
}

/** Tolerância de Y para considerar itens na mesma linha visual. */
const SAME_ROW_Y_TOLERANCE = 2.5;

/**
 * Agrupa os itens por coordenada em linhas de texto, na ordem de leitura
 * (topo→base, esquerda→direita, página a página). Colunas na mesma linha
 * visual viram uma linha só, unidas por espaço.
 */
export function groupItemsIntoRows(pages: PdfPageText[]): PdfRow[] {
  const rows: PdfRow[] = [];

  for (const page of pages) {
    let current: { y: number; parts: string[] } | null = null;

    for (const item of page.items) {
      if (current && Math.abs(current.y - item.y) <= SAME_ROW_Y_TOLERANCE) {
        current.parts.push(item.str);
        continue;
      }
      if (current) {
        rows.push({ page: page.page, y: current.y, text: current.parts.join(" ") });
      }
      current = { y: item.y, parts: [item.str] };
    }

    if (current) {
      rows.push({ page: page.page, y: current.y, text: current.parts.join(" ") });
    }
  }

  return rows;
}

/** Atalho: PDF -> linhas de texto prontas para o parser. */
export async function extractPdfRows(buffer: ArrayBuffer): Promise<PdfRow[]> {
  const pages = await extractPdfText(buffer);
  return groupItemsIntoRows(pages);
}
