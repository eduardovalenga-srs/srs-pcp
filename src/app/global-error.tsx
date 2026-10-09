"use client";

/**
 * Fronteira para erros do layout raiz (a error.tsx não alcança ele).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <main className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
          <div className="grid gap-3">
            <h1 className="text-2xl font-semibold">Algo deu errado</h1>
            <p className="text-sm text-gray-600">
              {error.message || "Tente novamente. Se o problema continuar, contate o administrador."}
            </p>
            {error.digest ? <p className="text-xs text-gray-500">Código: {error.digest}</p> : null}
            <button
              type="button"
              onClick={reset}
              className="mx-auto h-10 rounded-md bg-[#1B2A5E] px-4 text-sm font-medium text-white"
            >
              Tentar novamente
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
