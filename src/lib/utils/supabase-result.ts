/** Mensagem de erro mínima compartilhada com o PostgREST. */
interface ErrorLike {
  message: string;
}

/**
 * Converte erro do PostgREST em erro tratável pela aplicação.
 * Toda operação crítica passa por aqui para garantir tratamento de erro.
 */
export function assertOk(error: ErrorLike | null | undefined, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

/** Extrai mensagem amigável de qualquer erro lançado nas camadas de serviço. */
export function errorMessage(error: unknown, fallback = "Não foi possível concluir a operação."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
