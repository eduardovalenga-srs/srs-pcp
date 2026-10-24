import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";

export default function NovoRomaneioLoading() {
  return (
    <>
      <Header title="Novo romaneio" description="Carregando OFs…" />
      <p role="status" className="sr-only">
        Carregando OFs candidatas…
      </p>

      <div className="space-y-3">
        <div className="rounded border bg-card p-3">
          <Skeleton className="h-9 w-full max-w-md" />
        </div>

        <div className="space-y-1.5 rounded border bg-card p-3">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </>
  );
}
