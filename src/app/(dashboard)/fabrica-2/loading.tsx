import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/layout/Header";

export default function Fabrica2Loading() {
  return (
    <>
      <Header title="Fábrica 2" description="Carregando…" />

      <div className="space-y-3">
        <div className="rounded border bg-card p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full col-span-2" />
          ))}
        </div>

        <div className="space-y-1.5 rounded border bg-card p-3">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </>
  );
}
