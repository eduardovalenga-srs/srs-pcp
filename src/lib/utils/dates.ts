import { format, isValid } from "date-fns";

/**
 * Fuso horário do negócio (calendário de produção da fábrica).
 * Configurável via env BUSINESS_TIMEZONE.
 */
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIMEZONE ?? "America/Sao_Paulo";

/** Formata uma data para exibição (dd/MM/yyyy). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = toDate(value);
  if (!date) return "—";
  return format(date, "dd/MM/yyyy");
}

/** Formata apenas dia e mês (dd/MM) — listas compactas sem scroll. */
export function formatDayMonth(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = toDate(value);
  if (!date) return "—";
  return format(date, "dd/MM");
}

/** Formata data e hora local (dd/MM/yyyy HH:mm). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : parseDateTime(value);
  if (!date || !isValid(date)) return "—";
  return format(date, "dd/MM/yyyy HH:mm");
}

/** Converte 'YYYY-MM-DD' em Date local (sem deslocamento de fuso). */
export function parseISODateToLocal(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isValid(date) ? date : null;
}

/** Converte string (YYYY-MM-DD, ISO completo ou dd/MM/yyyy) ou Date em Date. */
export function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return isValid(value) ? value : null;

  const onlyDate = parseISODateToLocal(value);
  if (onlyDate) return onlyDate;

  const parsed = new Date(value);
  return isValid(parsed) ? parsed : null;
}

function parseDateTime(value: string): Date | null {
  const date = parseISODateToLocal(value);
  if (date && /\d{2}:\d{2}/.test(value)) {
    const timeMatch = value.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (timeMatch) {
      date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3] ?? "0"), 0);
      return date;
    }
  }
  const parsed = new Date(value);
  return isValid(parsed) ? parsed : null;
}

/**
 * Data corrente no fuso do negócio (YYYY-MM-DD).
 * Não usar toISOString() para comparações com colunas DATE:
 * ele converte para UTC e pode "andar um dia".
 */
export function todayISODate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** YYYY-MM-DD a partir de um Date (partes locais). */
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Data futura (dias) no formato YYYY-MM-DD. */
export function addDaysISODate(days: number, from: Date = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Some dias a uma data ISO preservando o formato. */
export function addDaysToISODate(isoDate: string, days: number): string {
  const base = parseISODateToLocal(isoDate) ?? new Date();
  base.setDate(base.getDate() + days);
  return toISODate(base);
}

/**
 * Dia útil (segunda a sexta)? Sábado, domingo ou data ilegível → false.
 * Feriados não são considerados (não há calendário de feriados no projeto).
 */
export function isBusinessDay(isoDate: string): boolean {
  // Round-trip rejeita datas ilegíveis (ex.: 2026-02-30 rolaria de forma silenciosa).
  if (!isValidISODate(isoDate)) return false;
  const date = parseISODateToLocal(isoDate);
  if (!date) return false;
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Último dia útil ESTRICTAMENTE anterior à data (pula sábado/domingo).
 * Data ilegível → devolve a própria entrada (sem efeitos colaterais).
 */
export function previousBusinessDay(isoDate: string): string {
  const date = parseISODateToLocal(isoDate);
  if (!date) return isoDate;
  do {
    date.setDate(date.getDate() - 1);
  } while (!isBusinessDay(toISODate(date)));
  return toISODate(date);
}

/**
 * Subtrai `days` dias úteis (só seg–sex) de uma data ISO.
 * `days = 0` devolve a própria data; entrada ilegível retorna sem alteração.
 */
export function subBusinessDays(isoDate: string, days: number): string {
  const date = parseISODateToLocal(isoDate);
  if (!date) return isoDate;
  let remaining = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    if (isBusinessDay(toISODate(date))) remaining -= 1;
  }
  return toISODate(date);
}

export interface ParsedDateResult {
  value: string | null;
  error: string | null;
}

/**
 * Converte valores vindos de planilha em YYYY-MM-DD.
 * Aceita: Date, serial do Excel, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD e
 * timestamps ISO. Retorna mensagem de erro quando não interpreta.
 */
export function parseSpreadsheetDate(input: unknown): ParsedDateResult {
  if (input === null || input === undefined || input === "") {
    return { value: null, error: "Data vazia" };
  }

  if (input instanceof Date) {
    if (!isValid(input)) return { value: null, error: "Data inválida" };
    return { value: toISODate(input), error: null };
  }

  if (typeof input === "number") {
    return parseExcelSerialDate(input);
  }

  const raw = String(input).trim();
  if (!raw) return { value: null, error: "Data vazia" };

  // Serial do Excel armazenado como texto ("45945")
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    // Datas reais em serial ficam entre ~1982 e ~2160
    if (serial > 30000 && serial < 80000) return parseExcelSerialDate(serial);
    return { value: null, error: `Data inválida: "${raw}"` };
  }

  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return buildDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), raw);
  }

  const dmyMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    return buildDate(Number(dmyMatch[3]), Number(dmyMatch[2]), Number(dmyMatch[1]), raw);
  }

  const fallback = new Date(raw);
  if (isValid(fallback)) return { value: toISODate(fallback), error: null };

  return { value: null, error: `Data inválida: "${raw}"` };
}

function parseExcelSerialDate(serial: number): ParsedDateResult {
  if (!Number.isFinite(serial) || serial <= 0) {
    return { value: null, error: `Data serial inválida: ${serial}` };
  }
  // Epoch do sistema de datas do Excel (bug do ano bissexto de 1900)
  const utcMillis = Math.round((serial - 25569) * 86_400_000);
  const utc = new Date(utcMillis);
  if (!isValid(utc)) return { value: null, error: `Data serial inválida: ${serial}` };
  return { value: toISODate(utc), error: null };
}

function buildDate(year: number, month: number, day: number, raw: string): ParsedDateResult {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { value: null, error: `Data inválida: "${raw}"` };
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value: null, error: `Data inexistente: "${raw}"` };
  }
  return { value: toISODate(date), error: null };
}

export function isValidISODate(value: string): boolean {
  const date = parseISODateToLocal(value);
  // Round-trip rejeita datas inexistentes (ex.: 2026-02-30 rolaria para 02/03).
  return date !== null && toISODate(date) === value;
}
