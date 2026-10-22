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
 * Código da OF gerado da DATA DE ENTREGA (base, sem sufixo) — a lista de
 * peças e conjuntos (038) e a lista de peças do projeto não trazem
 * código: dia e mês viram o número, no mesmo padrão "<TIPO> <número>" dos
 * demais pedidos ("2026-11-05" -> "OF 0511").
 *
 * Determinístico de propósito: reimportar o mesmo arquivo com a mesma
 * entrega gera o MESMO código e cai no fluxo de decisão da prévia
 * (UPDATE/KEEP/SKIP) em vez de criar uma OF duplicada. Os formatos que
 * geram código usam {@link orderCodeFromDateAndFileKey} — esta função é
 * só a parte da data.
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

/**
 * Chave do arquivo para o sufixo do código da OF: hash FNV-1a (32 bits)
 * dos bytes, em base36 com 4 caracteres. Estável para o MESMO arquivo —
 * a prévia e a execução derivam o mesmo código e a reimportação cai no
 * fluxo de decisão da prévia — e praticamente única entre arquivos
 * distintos, evitando que dois projetos com a MESMA entrega caiam na
 * mesma OF.
 */
export function fileKeyFromBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(-4);
}

/**
 * Código da OF para os formatos cujo arquivo NÃO traz número (lista de
 * peças e conjuntos da 038 e lista de peças do projeto): dia+mês da
 * entrega + sufixo derivado dos bytes do arquivo — "2026-11-05" com a
 * chave "3k7q" vira "OF 0511-3K7Q".
 *
 * O sufixo mantém projetos distintos com a mesma entrega em OFs
 * separadas sem perder a determinística: mesmo arquivo + mesma entrega
 * geram sempre o mesmo código (reimportação deduplica pela prévia), e a
 * prévia e a execução da mesma importação nunca divergem.
 */
export function orderCodeFromDateAndFileKey(
  deliveryDate: string,
  fileKey: string,
): { code: string; type: OrderType } {
  const base = orderCodeFromDeliveryDate(deliveryDate);
  const suffix = fileKey.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!suffix) return base;
  const number = base.code.slice(base.type.length + 1);
  return normalizeOrderCode(`${number}-${suffix}`, base.type);
}
