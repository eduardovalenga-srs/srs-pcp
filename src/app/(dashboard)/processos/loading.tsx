import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProcessosLoading() {
  return (
    <>
      <Header title="Processos" description="Carregando…" />
      <Skeleton className="h-10 w-full" />
      <div className="space-y-1.5 rounded border bg-card p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </>
  );
}
