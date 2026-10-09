import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConfiguracoesLoading() {
  return (
    <>
      <Header title="Configurações" description="Carregando…" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </>
  );
}
