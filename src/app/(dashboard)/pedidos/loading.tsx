import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";

export default function PedidosLoading() {
  return (
    <>
      <Header title="Pedidos" description="Carregando…" />
      <p role="status" className="sr-only">
        Carregando pedidos…
      </p>

      <div className="space-y-3">
        <div className="rounded border bg-card p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="space-y-1.5 rounded border bg-card p-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-64" />
        </div>
      </div>
    </>
  );
}
