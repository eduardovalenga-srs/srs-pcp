import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ListPageProps {
  children: ReactNode;
  className?: string;
}

interface ListSectionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Casca das telas de lista (084).
 *
 * No desktop ocupa exatamente a altura disponível do shell: cabeçalho,
 * filtros e resumo ficam parados e só a lista rola. No mobile a altura é
 * natural — a área de conteúdo do layout rola e o rodapé de paginação
 * fica `sticky` no fim da tela.
 */
export function ListPage({ children, className }: ListPageProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:shrink-0 lg:overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Bloco fixo do topo da lista (filtros, resumo, chips). */
export function ListTop({ children, className }: ListSectionProps) {
  return <div className={cn("shrink-0 space-y-3", className)}>{children}</div>;
}

/**
 * Área rolável da lista: rolagem vertical e horizontal com o cabeçalho
 * da tabela grudado no topo. É o único scroller do quadro, então a barra
 * horizontal fica na borda inferior — logo acima do rodapé fixo.
 */
export function ListScroll({ children, className }: ListSectionProps) {
  return (
    <div
      className={cn(
        "min-h-0 overflow-auto overscroll-contain rounded border bg-card lg:flex-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Rodapé fixo da lista (paginação). No desktop fica parado no fim da
 * coluna; no mobile acompanha a rolagem colado no rodapé da tela.
 */
export function ListFooter({ children, className }: ListSectionProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 shrink-0 border-t bg-card px-3 py-2 lg:static",
        className,
      )}
    >
      {children}
    </div>
  );
}
