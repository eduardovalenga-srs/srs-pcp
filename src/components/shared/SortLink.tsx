"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Estado de ordenação vigente de uma lista. */
export interface SortState {
  sort: string;
  sortDir: "asc" | "desc";
}

interface SortLinkProps {
  label: string;
  /** Nome completo da coluna (o que o leitor de tela anuncia). */
  fullName: string;
  /** Chave de ordenação da coluna (whitelist do parser/banco). */
  columnId: string;
  /** Ordenação vigente da tela. */
  sort: string;
  sortDir: "asc" | "desc";
  /**
   * Monta o href COMPLETO para um novo estado de ordenação — cada tela
   * usa sua query-string function (e sempre volta para a página 1).
   * Fora do React o componente é testável com renderToStaticMarkup.
   */
  buildHref: (next: SortState) => string;
}

/**
 * 043: indicador de ordenação de coluna — o servidor decide a ordem via
 * URL (`?ordem=&direcao=`), nunca sorting client-side (a paginação é
 * server-side). Componente COMPARTILHADO e deliberadamente "burro": o
 * estado e a montagem do href vêm de cada tela.
 */
export function SortLink({ label, fullName, columnId, sort, sortDir, buildHref }: SortLinkProps) {
  const active = sort === columnId;
  const currentDir = active ? sortDir : "asc";
  const next: SortState = {
    sort: columnId,
    sortDir: active && sortDir === "asc" ? "desc" : "asc",
  };
  const Icon = active ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <Link
      href={buildHref(next)}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
        !active && "text-muted-foreground",
        // Os cabeçalhos são text-muted-foreground — o ativo se destaca.
        active && "text-foreground",
      )}
      aria-label={`Ordenar por ${fullName}${active ? `, atualmente ${currentDir === "asc" ? "crescente" : "decrescente"}` : ""}`}
      title={fullName}
    >
      <span className="truncate" aria-hidden>
        {label}
      </span>
      <Icon className={cn("h-3 w-3 shrink-0", active ? "opacity-100" : "opacity-40")} aria-hidden />
    </Link>
  );
}
