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
