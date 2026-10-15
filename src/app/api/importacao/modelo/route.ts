import * as XLSX from "xlsx";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { errorMessage } from "@/lib/utils/supabase-result";

/**
 * GET /api/importacao/modelo — planilha modelo (.xlsx) do layout novo.
 *
 * O arquivo espelha o formato da fábrica: duas linhas de cabeçalho
 * (rótulo + nome técnico) e exemplos de item pai com filhos e de item
 * pai sem filhos (matéria-prima direta). Linhas com ps_Tipo = "X" são
 * descartadas na importação. O reconhecimento é 100% pelo nome
 * técnico — colunas extras (obra, área, desenhos) são ignoradas.
 * A segunda aba "INSTRUÇÕES" explica a hierarquia, o formulário da
 * importação e as decisões de conflito.
 */

const TEMPLATE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEMPLATE_FILE_NAME = "modelo-importacao-of.xlsx";

/** [rótulo pt-BR, nome técnico] — na mesma ordem das colunas. */
const COLUMNS: [string, string][] = [
  ["OF/OS", "OF_TIPO"],
  ["Código OF", "of_idOF"],
  ["Descrição OF", "of_Descr"],
  ["Item pai", "ps_idPos"],
  ["Descrição (item pai)", "ps_Descr"],
  ["Tipo (E = com filhos / X = linha ignorada)", "ps_Tipo"],
  ["QTD (item pai)", "ps_Qtde"],
  ["PESO UNIT. kg (item pai)", "ps_Peso"],
  ["KG TOTAL (item pai)", "pos_PesoTotal"],
  ["Código MP (pai)", "ps_idMat"],
  ["DESCRIÇÃO MP (pai — linha sem filhos)", "ps_DesMaterial"],
  ["Qualidade MP (pai)", "ps_Qualidade"],
  ["Filho (croqui)", "cp_comp"],
  ["Descrição (filho)", "cp_compdescr"],
  ["QTD ESTR (filho)", "cp_compqtdetotal"],
  ["PESO UNIT. kg (filho)", "cp_comppeso"],
  ["KG TOTAL (filho)", "cp_comppesototal"],
  ["Código MP (filho)", "co_compcodmat"],
  ["DESCRIÇÃO MP (filho)", "cp_DesMaterial"],
  ["Qualidade MP (filho)", "cp_Qualidade"],
];

/**
 * Exemplos:
 *  - 72ST18-018 (tipo E): dois filhos, cada um com sua matéria-prima;
 *  - 72ST18-025 (sem tipo, sem filhos): matéria-prima direta no pai.
 * Código OF vazio nas linhas continuadas é preenchido igual na fábrica.
 */
const EXAMPLE_ROWS: (string | number | null)[][] = [
  ["OF", "107482", "GUARDA CORPO MOLDUREIRA", "72ST18-018", "GUARDA CORPO", "E", 1, 12.48, 12.48, "00000", "SEM MATERIAL", null, "72-742", "GUARDA CORPO", 3, 4.16, 12.48, "T1318", "TB42.20X3.56 (1.1/4 SCH40)", "SCH40"],
  ["OF", "107482", "GUARDA CORPO MOLDUREIRA", "72ST18-018", "GUARDA CORPO", "E", 1, 12.48, 12.48, "00000", "SEM MATERIAL", null, "72-766", "GUARDA CORPO", 2, 3.05, 6.10, "T1318", "TB42.20X3.56 (1.1/4 SCH40)", "SCH40"],
  ["OF", "107482", "GUARDA CORPO MOLDUREIRA", "72ST18-025", "BOTÃO DE PORTA", "", 2, 1.09, 2.18, "T1318", "TB42.20X3.56 (1.1/4 SCH40)", "SCH40", null, null, null, null, null, null, null, null],
];

const INSTRUCTIONS: [string, string][] = [
  ["Formato", "O arquivo descreve a árvore da OF: pedido (OF_TIPO + of_idOF) -> itens pai (ps_idPos) -> itens filhos (cp_comp) -> matéria-prima por item (cp_DesMaterial)."],
  ["Colunas obrigatórias", "of_idOF, ps_idPos, ps_Descr e cp_comp precisam existir como cabeçalho técnico (3ª linha do arquivo da fábrica; 2ª linha neste modelo). As demais colunas do layout são reconhecidas pelo nome — a posição não importa."],
  ["Colunas ignoradas", "Obra, área, comprimento, desenhos e revisões (os_nmObra, ps_Area, ds_*, *_Rev, ...) não são importadas."],
  ["Cliente e data de entrega", "A planilha NÃO traz cliente nem data: esses dois campos são digitados no formulário da importação e valem para todos os registros (OF, pais e filhos)."],
  ["TP (família)", "A família é calculada automaticamente como as iniciais da descrição do próprio item (GUARDA CORPO -> GC)."],
  ["Processos e OP", "O arquivo não traz status de processo nem OP. Os processos do catálogo são criados automaticamente em \"não iniciado\" para cada item pai e filho; a OP fica em branco até ser vinculada."],
  ["Matéria-prima", "Filho: descrição em cp_DesMaterial, quantidade igual à do filho, unidade \"UN\" e código/qualidade em observações. Pai sem filhos: ps_DesMaterial com a mesma regra. Linhas com ps_Tipo = X são ignoradas."],
  ["Conflitos", "Se a OF já existir no sistema, a prévia mostra as diferenças de cada campo (sistema x arquivo) e pergunta o que fazer: atualizar diferenças, manter dados do sistema ou ignorar a OF. O status dos processos e a OP dos itens que permanecem nunca são alterados pela importação."],
  ["Prévia obrigatória", "Nada é gravado antes da confirmação: a prévia lista erros (excluem a OF inteira), alertas e a estrutura que será criada."],
  ["Limites", "Arquivo .xlsx ou .xls de até 20 MB e no máximo 20.000 linhas. Macros e fórmulas não são executados."],
];

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "import.access")) {
      return Response.json({ error: "Seu perfil não tem permissão para baixar o modelo." }, { status: 403 });
    }

    const labels = COLUMNS.map(([label]) => label);
    const technicals = COLUMNS.map(([, technical]) => technical);
    const modelSheet = XLSX.utils.aoa_to_sheet([labels, technicals, ...EXAMPLE_ROWS]);
    modelSheet["!cols"] = labels.map((label) => ({ wch: Math.min(30, Math.max(12, label.length + 2)) }));

    const instructionsSheet = XLSX.utils.aoa_to_sheet([["Tópico", "O que saber"], ...INSTRUCTIONS]);
    instructionsSheet["!cols"] = [{ wch: 26 }, { wch: 120 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, modelSheet, "MODELO");
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "INSTRUÇÕES");

    // type "buffer" do SheetJS: materializado como bytes sobre ArrayBuffer.
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array<ArrayBuffer>;

    return new Response(bytes, {
      headers: {
        "Content-Type": TEMPLATE_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${TEMPLATE_FILE_NAME}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível gerar o modelo de planilha.") },
      { status: 500 },
    );
  }
}
