"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Opção do combobox — rótulo + detalhe opcional à direita. */
export interface ComboboxOption {
  value: string;
  label: string;
  /** Detalhe exibido ao lado do rótulo (ex.: "Entrega 20/10/2026"). */
  hint?: string;
  /** Sinalização em badge (ex.: "Simulação aberta"). */
  badge?: string;
}

/**
 * Filtro "digita enquanto digita" das opções: casa por trecho do rótulo
 * ou do detalhe, sem diferenciar caixa nem acentos ("acme" acha "ACME",
 * "serra" acha "Serralheria").
 */
export function filterComboboxOptions(
  options: readonly ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const term = normalizeComboboxText(query);
  if (!term) return [...options];
  return options.filter((option) =>
    normalizeComboboxText(`${option.label} ${option.hint ?? ""} ${option.badge ?? ""}`).includes(
      term,
    ),
  );
}

/** Remove acentos, caixa e espaços repetidos para a comparação. */
function normalizeComboboxText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ComboboxProps {
  /** Id do gatilho (o rótulo usa `htmlFor` nele). */
  id: string;
  /** Rótulo visível do campo. */
  label: string;
  placeholder: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Mensagem quando o filtro não deixa nenhuma opção. */
  emptyMessage?: string;
  className?: string;
}

/**
 * Combobox com filtro por digitação (Popover + input): o gatilho mostra a
 * opção escolhida e o painel filtra as opções enquanto o usuário digita.
 * Sem dependência nova — montado sobre os primitivos já usados na tela.
 */
export function Combobox({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  emptyMessage = "Nenhuma opção encontrada.",
  className,
}: ComboboxProps) {
  const listId = useId();
  const filterId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => filterComboboxOptions(options, query), [options, query]);

  const choose = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-2"
        aria-label={label}
      >
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={filterId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={`Filtrar ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const first = filtered[0];
                if (first) choose(first.value);
              }
            }}
            placeholder="Filtrar…"
            className="h-8 pl-8"
            autoComplete="off"
            autoFocus
          />
        </div>

        <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <li role="presentation" className="px-2 py-1.5 text-sm text-muted-foreground">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((option) => (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => choose(option.value)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                    "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    option.value === value && "bg-accent",
                  )}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.badge ? (
                    <Badge variant="warning" className="shrink-0 normal-case">
                      {option.badge}
                    </Badge>
                  ) : null}
                  {option.hint ? (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {option.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
