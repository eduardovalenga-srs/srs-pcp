import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";

export default function RomaneioDetalheLoading() {
  return (
    <>
      <Header title="Romaneio" description="Carregando…" />
      <p role="status" className="sr-only">
        Carregando romaneio…
      </p>

      <div className="space-y-3">
        <div className="rounded border bg-card p-3">
          <Skeleton className="h-6 w-64" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="rounded border bg-card p-3">
          <Skeleton className="h-5 w-40" />
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="space-y-1.5 rounded border bg-card p-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>

        <div className="space-y-1.5 rounded border bg-card p-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </>
  );
}
