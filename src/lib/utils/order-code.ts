import { type OrderType } from "@/lib/constants/orders";

/**
 * Normaliza o código do pedido para o padrão "<TIPO> <número>" — ex.:
 * "OF 107482" — o mesmo que a importação da planilha produz
 * (`of-structure` usava esta lógica local; agora é uma só fonte).
 *
 * O prefixo no próprio código vence o tipo informado: "OS 99" digitado
 * num pedido com tipo OF continua OS (mesma regra do arquivo da fábrica).
 * Aceita variações "OF-1234", "of 1234", "OF1234" — o separador vira
 * sempre espaço, para casar com a chave de dedupe da reimportação.
 */
export function normalizeOrderCode(id: string, typeHint: OrderType | string): {
  code: string;
  type: OrderType;
} {
  const prefixed = /^(OF|OS)[\s-]*(.*)$/i.exec(id.trim());
  const type: OrderType = prefixed
    ? (prefixed[1].toUpperCase() as OrderType)
    : typeHint.toUpperCase() === "OS"
      ? "OS"
      : "OF";
  const rawId = (prefixed ? prefixed[2] : id).trim();
  return { code: `${type} ${rawId}`.trim(), type };
}

/**
 * Tamanho máximo do trecho do nome do arquivo usado no código da OF —
 * mantém o código legível (e a coluna "OF" das telas sem estourar) mesmo
 * com nomes de arquivo longos ("Ordem de Fabricação ...").
 */
const MAX_FILE_LABEL_LENGTH = 30;

/**
 * Rótulo do arquivo para o código da OF: o NOME SEM A EXTENSÃO, normalizado
 * para o formato do código — sem acento, maiúsculo e com as sequências de
 * caracteres especiais trocadas por "-" (as mesmas convenções de
 * `normalizeOrderCode`, que depois reconhece o prefixo OF/OS).
 *
 * Exemplos: "TT10.xlsx" -> "TT10"; "tt4 gc (5) (1).xlsx" ->
 * "TT4-GC-5-1"; "Ordem de Fabricação 123.xlsx" -> "ORDEM-DE-FABRICACAO-123".
 * Devolve "" quando o nome não tem nenhum caractere aproveitável.
 */
export function fileLabelFromFileName(fileName: string): string {
  // Nome puro: descarta caminho (upload antigo pode vir com pasta) e a
  // extensão (tudo depois do ÚLTIMO ponto do nome).
  const baseName = fileName.split(/[\\/]/).pop() ?? "";
  const withoutExtension = baseName.replace(/\.[^.]+$/, "");

  const label = withoutExtension
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (label.length <= MAX_FILE_LABEL_LENGTH) return label;
  // Corte no último "-" antes do limite, para não partir uma palavra.
  const clipped = label.slice(0, MAX_FILE_LABEL_LENGTH);
  const lastDash = clipped.lastIndexOf("-");
  return (lastDash > 0 ? clipped.slice(0, lastDash) : clipped).replace(/-+$/g, "");
}

/**
 * Código da OF para os formatos cujo arquivo NÃO traz número (lista de
 * peças e conjuntos da 038 e lista de peças do projeto): o NOME DO ARQUIVO
 * sem a extensão é o número do pedido — "TT10.xlsx" vira "OF TT10" e
 * "tt4 gc (5) (1).xlsx" vira "OF TT4-GC-5-1".
 *
 * A entrega NÃO entra no código (continua obrigatória no formulário: é a
 * data dos itens e a base das janelas dos processos). Determinístico de
 * propósito: reimportar o MESMO arquivo gera o mesmo código e cai na
 * decisão Atualizar/Manter/Ignorar da prévia em vez de criar OF nova —
 * renomear o arquivo, porém, passa a ser outra OF (o nome é a identidade
 * que o cliente usa no projeto).
 *
 * Lança erro quando o nome não gera nenhum caractere válido (ex.:
 * "###.xlsx") — é entrada inválida, não falha do sistema.
 */
export function orderCodeFromFileName(fileName: string): { code: string; type: OrderType } {
  const label = fileLabelFromFileName(fileName);
  if (!label) {
    throw new Error("Não foi possível gerar o código da OF a partir do nome do arquivo.");
  }
  return normalizeOrderCode(label, "OF");
}
