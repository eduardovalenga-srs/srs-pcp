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
 * Código da OF gerado da DATA DE ENTREGA para a lista de peças e conjuntos
 * (038) — a lista não traz código: dia e mês viram o número, no mesmo
 * padrão "<TIPO> <número>" dos demais pedidos ("2026-11-05" -> "OF 0511").
 *
 * Determinístico de propósito: reimportar o mesmo arquivo com a mesma
 * entrega gera o MESMO código e cai no fluxo de decisão da prévia
 * (UPDATE/KEEP/SKIP) em vez de criar uma OF duplicada.
 */
export function orderCodeFromDeliveryDate(deliveryDate: string): {
  code: string;
  type: OrderType;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deliveryDate.trim());
  if (!match) {
    throw new Error("Data de entrega inválida (AAAA-MM-DD) para gerar o código da OF.");
  }
  const [, , month, day] = match;
  return normalizeOrderCode(`${day}${month}`, "OF");
}
