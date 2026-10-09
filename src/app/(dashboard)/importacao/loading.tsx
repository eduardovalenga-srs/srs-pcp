import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ImportacaoLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Carregando importação…</span>

      <Header title="Importar planilha" description="Carregando…" />

      <div className="space-y-4">
        <div className="rounded border bg-card p-4">
          <Skeleton className="mb-3 h-5 w-56" />
          <div className="rounded border border-dashed p-6">
            <Skeleton className="mx-auto h-8 w-64" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded border bg-card p-4">
          <Skeleton className="h-5 w-48" />
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
