import { z } from "zod";

/**
 * Campo de texto opcional.
 *
 * Aceita "", null e undefined porque o mesmo schema valida os dois sentidos:
 * o formulário envia o *output* do zodResolver (vazio já vira null) e a
 * planilha chega como texto. Rejeitar null aqui derrubava o salvamento com
 * a mensagem genérica "Invalid input".
 */
export const nullableText = (max = 500) =>
  z
    .union([z.literal(""), z.string().trim().max(max, `Máximo de ${max} caracteres`)])
    .nullable()
    .optional()
    .transform((value) => (value === "" || value === null || value === undefined ? null : value));

/** Data YYYY-MM-DD opcional (vazio/null/ausente -> null). */
export const nullableDate = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato DD/MM/AAAA")])
  .nullable()
  .optional()
  .transform((value) => (value === "" || value === null || value === undefined ? null : value));

/**
 * Número aceitando texto digitado ("80,5" com vírgula) OU número já convertido.
 *
 * Aceita as duas formas porque o mesmo schema é usado nos dois sentidos:
 *  - formulário: o react-hook-form envia o *output* (number) para a Server Action;
 *  - importação/Excel: a planilha chega como texto.
 * Sem isto, `safeParse` do servidor falhava com
 * "Invalid input: expected string, received number".
 */
export const decimalInput = (label: string, { min = 0 }: { min?: number } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((raw, ctx) => {
      if (typeof raw === "number") {
        if (!Number.isFinite(raw)) {
          ctx.addIssue({ code: "custom", message: `${label} inválido` });
          return z.NEVER;
        }
        if (raw < min) {
          ctx.addIssue({ code: "custom", message: `${label} deve ser maior ou igual a ${min}` });
          return z.NEVER;
        }
        return raw;
      }

      const value = raw.trim();
      if (value === "") {
        ctx.addIssue({ code: "custom", message: `${label} é obrigatório` });
        return z.NEVER;
      }
      const normalized = value.replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d*\.?\d+$/.test(normalized)) {
        ctx.addIssue({ code: "custom", message: `${label} inválido` });
        return z.NEVER;
      }
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: "custom", message: `${label} inválido` });
        return z.NEVER;
      }
      if (parsed < min) {
        ctx.addIssue({ code: "custom", message: `${label} deve ser maior ou igual a ${min}` });
        return z.NEVER;
      }
      return parsed;
    });

/**
 * Número opcional: texto com vírgula, número já convertido, ou vazio
 * ("" / null / undefined -> null). Mesma lógica do formulário x planilha
 * explicada em `decimalInput`/`nullableText`.
 */
export const optionalDecimalInput = (label: string, { min = 0 }: { min?: number } = {}) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx) => {
      if (raw === null || raw === undefined) return null;

      if (typeof raw === "number") {
        if (!Number.isFinite(raw)) {
          ctx.addIssue({ code: "custom", message: `${label} inválido` });
          return z.NEVER;
        }
        if (raw < min) {
          ctx.addIssue({ code: "custom", message: `${label} deve ser maior ou igual a ${min}` });
          return z.NEVER;
        }
        return raw;
      }

      const value = raw.trim();
      if (value === "") return null;
      const normalized = value.replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d*\.?\d+$/.test(normalized)) {
        ctx.addIssue({ code: "custom", message: `${label} inválido` });
        return z.NEVER;
      }
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: "custom", message: `${label} inválido` });
        return z.NEVER;
      }
      if (parsed < min) {
        ctx.addIssue({ code: "custom", message: `${label} deve ser maior ou igual a ${min}` });
        return z.NEVER;
      }
      return parsed;
    });

/** Rótulos em português para os campos validados pela aplicação. */
const FIELD_LABELS: Record<string, string> = {
  id: "Identificador",
  code: "Número do pedido",
  type: "Tipo de pedido",
  customerName: "Cliente",
  description: "Descrição",
  orderDate: "Data do pedido",
  deliveryDate: "Data de entrega",
  status: "Situação",
  op: "Ordem de Produção (OP)",
  family: "Família",
  parentItem: "Item pai",
  quantity: "Quantidade",
  unit: "Unidade",
  unitWeightKg: "Peso unitário",
  processCodes: "Processos",
  processCode: "Processo",
  items: "Itens",
  name: "Nome",
  displayOrder: "Ordem de exibição",
  active: "Ativo",
  quantityPlanned: "Quantidade planejada",
  quantityCompleted: "Quantidade produzida",
  notes: "Observações",
  file: "Arquivo",
  sheetName: "Aba da planilha",
  mappings: "Mapeamento de colunas",
  mode: "Modo de importação",
  batchId: "Prévia",
  hasDescription: "Descrição",
  hasQuantity: "Quantidade",
  hasOrderCode: "Número do pedido",
};

/** Tradução dos tipos esperados pelo zod. */
const TYPE_LABELS: Record<string, string> = {
  string: "texto",
  number: "número",
  int: "número inteiro",
  boolean: "verdadeiro/falso",
  array: "lista",
  object: "objeto",
  date: "data",
  null: "vazio",
  undefined: "vazio",
  bigint: "número inteiro",
};

/** "Item 2 — Quantidade" / "Descrição" (caminho do campo dentro do schema). */
function fieldLabel(path: PropertyKey[]): string {
  if (path.length === 0) return "";
  const key = String(path[path.length - 1]);
  const label = FIELD_LABELS[key] ?? key;
  if (path.length >= 2 && String(path[0]) === "items") {
    const index = Number(path[1]);
    if (Number.isInteger(index)) return `Item ${index + 1} — ${label}`;
  }
  return label;
}

/**
 * Mensagens padrão do zod, que saem em inglês
 * ("Invalid input: expected string, received number", "Too small: ...").
 * O que não casa aqui é mensagem própria da aplicação e é exibida como está.
 */
const ZOD_DEFAULT_MESSAGE = /^(Too small|Too big|Invalid|Unrecognized|Not multiple of)/;

function isZodDefaultMessage(message: string): boolean {
  return ZOD_DEFAULT_MESSAGE.test(message);
}

/** Mensagem de um issue do zod, em português (as custom já vêm em pt-BR). */
function describeIssue(issue: z.ZodIssue): string {
  // Mensagem escrita pela aplicação ("Informe o número do pedido") — exibir como está.
  if (!isZodDefaultMessage(issue.message)) return issue.message;

  const label = fieldLabel(issue.path);
  const prefix = label ? `${label}: ` : "";

  switch (issue.code) {
    case "invalid_type": {
      const expected = TYPE_LABELS[issue.expected] ?? issue.expected;
      return `${prefix}valor inválido (esperado ${expected})`;
    }
    case "too_small": {
      const minimum = String(issue.minimum);
      if (issue.origin === "string") return `${prefix}deve ter ao menos ${minimum} caracteres`;
      if (issue.origin === "array" || issue.origin === "set") {
        return `${prefix}precisa de ao menos ${minimum} itens`;
      }
      return `${prefix}deve ser maior ou igual a ${minimum}`;
    }
    case "too_big": {
      const maximum = String(issue.maximum);
      if (issue.origin === "string") return `${prefix}deve ter no máximo ${maximum} caracteres`;
      if (issue.origin === "array" || issue.origin === "set") {
        return `${prefix}deve ter no máximo ${maximum} itens`;
      }
      return `${prefix}deve ser menor ou igual a ${maximum}`;
    }
    case "invalid_format":
      return `${prefix}formato inválido`;
    case "unrecognized_keys":
      return `Campo desconhecido: ${issue.keys.join(", ")}`;
    case "invalid_union": {
      const nested = "errors" in issue ? issue.errors.flat() : [];
      // União (ex.: nullableText): prefere a mensagem própria de dentro dela
      // ("Máximo de 200 caracteres") antes da genérica da união.
      const preferred = nested.find((entry) => !isZodDefaultMessage(entry.message)) ?? nested[0];
      return preferred ? describeIssue(preferred) : `${prefix}valor inválido`;
    }
    default:
      return `${prefix}valor inválido`;
  }
}

/**
 * Extrai a primeira mensagem de erro de um erro do Zod, em português.
 * Sem isto o usuário via a mensagem nativa do zod em inglês
 * ("Invalid input: expected string, received number").
 */
export function firstZodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? describeIssue(issue) : "Dados inválidos";
}
