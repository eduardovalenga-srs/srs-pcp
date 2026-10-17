"use client";

import { useId, useState, type ReactNode } from "react";
import { Filter, X } from "lucide-react";

import { normalizeDeliveryPeriod } from "@/lib/utils/filters";
import { toNumber } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Primitivos de filtro de cabeçalho compartilhados entre a gestão de
 * entregas e a Fábrica 1. As telas passam apenas os VALORES vigentes e a
 * forma de aplicá-los — cada uma monta sua própria query string na URL.
 */

export interface FilterOption {
  value: string;
  label: string;
}

/** Aparência compartilhada do funil de filtro no cabeçalho. */
export function funnelClassName(active: boolean): string {
  return cn(
    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
    "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-primary/15 text-primary" : "text-muted-foreground/60",
  );
}

export function funnelTitle(context: string): string {
  return `Filtrar por ${context}`;
}

export function funnelAriaLabel(context: string, active: boolean): string {
  return `${funnelTitle(context)}${active ? " — filtro ativo" : ""}`;
}

/** Ícone do funil — quando ativo, fica preenchido (além da cor). */
export function FunnelIcon({ active }: { active: boolean }) {
  return <Filter className={cn("h-3 w-3", active && "fill-current")} aria-hidden />;
}

export interface FilterMenuProps {
  /** Contexto do filtro, ex.: "situação do pedido" (vai para aria-label e título). */
  context: string;
  value: string;
  active: boolean;
  options: FilterOption[];
  onValueChange: (value: string) => void;
}

/**
 * Funil no cabeçalho da coluna: abre as opções daquele filtro.
 * O estado ativo não é comunicado só por cor — o ícone fica preenchido e o
 * rótulo acessível indica "filtro ativo".
 */
export function FilterMenu({ context, value, active, options, onValueChange }: FilterMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{context}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface TextColumnFilterProps {
  /** Valor vigente do campo principal. */
  value: string;
  /**
   * Segundo campo no mesmo painel (ex.: código do filho ao lado da
   * descrição). Quando ausente, o painel tem um único campo.
   */
  secondary?: { value: string; column: string };
  /** Aplica os campos; o segundo vem vazio quando o painel não o tem. */
  onApply: (value: string, secondaryValue: string) => void;
  /** Rótulo do campo principal, ex.: "Cliente". */
  column: string;
  /** Contexto do título/aria, ex.: "cliente". */
  context: string;
}

/** Filtro "contém" (valor parcial, sem diferenciar maiúsculas) da coluna de texto. */
export function TextColumnFilter({
  value,
  secondary,
  onApply,
  column,
  context,
}: TextColumnFilterProps) {
  const inputId = useId();
  const secondaryId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [secondaryDraft, setSecondaryDraft] = useState(secondary?.value ?? "");

  const active = value !== "" || (secondary?.value ?? "") !== "";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(value);
      setSecondaryDraft(secondary?.value ?? "");
    }
  };

  const commit = () => {
    const trimmed = draft.trim();
    const trimmedSecondary = secondaryDraft.trim();
    setDraft(trimmed);
    setSecondaryDraft(trimmedSecondary);
    onApply(trimmed, secondary ? trimmedSecondary : "");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3">
        <div className="space-y-1">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">
            {column} — contém
          </Label>
          <Input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            placeholder="Digite parte do valor…"
            autoComplete="off"
            className="h-8"
          />
        </div>

        {secondary ? (
          <div className="space-y-1">
            <Label htmlFor={secondaryId} className="text-xs text-muted-foreground">
              {secondary.column} — contém
            </Label>
            <Input
              id={secondaryId}
              value={secondaryDraft}
              onChange={(event) => setSecondaryDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              placeholder="Digite parte do valor…"
              autoComplete="off"
              className="h-8"
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active}
            onClick={() => {
              setDraft("");
              setSecondaryDraft("");
              onApply("", "");
              setOpen(false);
            }}
          >
            <X className="h-4 w-4" aria-hidden />
            Limpar
          </Button>
          <Button type="button" size="sm" onClick={commit}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface DeliveryPeriodPopoverProps {
  /** Funil cheio — qualquer parte do filtro de entrega está ligada. */
  active: boolean;
  /** Período vigente (null = lado aberto). */
  from: string | null;
  to: string | null;
  /** Aplica o período na URL (a tela decide o parâmetro). */
  onApply: (from: string | null, to: string | null) => void;
  /**
   * Limpa o filtro inteiro de entrega. Só aparece o botão quando informado —
   * na Fábrica 1 existe apenas o período, então a limpeza é idêntica à do
   * próprio painel e o botão fica de fora.
   */
  onClear?: () => void;
  /** Prefixo dos ids dos campos (cada tela tem os seus). */
  idPrefix: string;
  /** Conteúdo extra acima dos campos (ex.: janelas rápidas da gestão). */
  extra?: ReactNode;
  /** Contexto do título/aria do funil (padrão: "entrega"). */
  context?: string;
}

/**
 * Filtro de entrega por PERÍODO (De/Até) — compartilhado entre as telas.
 *
 * Rascunho local: o `<input type="date">` expõe "" enquanto a data está
 * incompleta, então aplicar a URL a cada tecla (ou no blur de um campo)
 * apagava o dia/mês já digitado e nem deixava preencher o outro lado. O
 * campo guarda o próprio rascunho e a URL só muda em "Aplicar"/Enter — e o
 * blur só navega quando os dois lados já estão preenchidos.
 */
export function DeliveryPeriodPopover({
  active,
  from,
  to,
  onApply,
  onClear,
  idPrefix,
  extra,
  context = "entrega",
}: DeliveryPeriodPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from ?? "");
  const [draftTo, setDraftTo] = useState(to ?? "");
  const [syncedFrom, setSyncedFrom] = useState(from);
  const [syncedTo, setSyncedTo] = useState(to);

  // Último período enviado à URL: o eco da navegação chega depois, com os
  // filtros novos, e não pode reescrever o rascunho do lado que o usuário
  // já está digitando em seguida.
  const [sent, setSent] = useState({ from, to });

  // Sincroniza o rascunho com a URL quando os filtros mudam por fora
  // (limpar filtros, chip, navegação) — padrão de "ajuste durante a renderização".
  if (syncedFrom !== from || syncedTo !== to) {
    setSyncedFrom(from);
    setSyncedTo(to);
    const echo = sent.from === from && sent.to === to;
    if (!echo) {
      setSent({ from, to });
      setDraftFrom(from ?? "");
      setDraftTo(to ?? "");
    }
  }

  const period = normalizeDeliveryPeriod(draftFrom, draftTo);

  /**
   * Aplica o período na URL. `completeOnly` é o caminho do blur: sair de um
   * campo com o outro lado ainda vazio não navega (o re-render apagaria o que
   * o usuário fosse digitar em seguida). Lado único só via Aplicar/Enter.
   */
  const commit = (completeOnly: boolean) => {
    if (period.error !== null) return;
    if (completeOnly && (period.from === null || period.to === null)) return;
    if (sent.from === period.from && sent.to === period.to) return;
    setSent({ from: period.from, to: period.to });
    onApply(period.from, period.to);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Cada abertura parte do período vigente — descartar edições abandonadas.
    if (next) {
      setDraftFrom(from ?? "");
      setDraftTo(to ?? "");
    }
  };

  const canApply = period.error === null && (period.from !== sent.from || period.to !== sent.to);
  const canClear = onClear !== undefined && active;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {extra}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-de`} className="text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id={`${idPrefix}-de`}
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(event) => setDraftFrom(event.target.value)}
              onBlur={() => commit(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(false);
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-ate`} className="text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id={`${idPrefix}-ate`}
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(event) => setDraftTo(event.target.value)}
              onBlur={() => commit(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(false);
                }
              }}
            />
          </div>
        </div>

        {period.error === "inverted" ? (
          <p className="text-xs text-destructive" role="status">
            A data inicial é posterior à final.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {canClear ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSent({ from: null, to: null });
                setDraftFrom("");
                setDraftTo("");
                onClear?.();
              }}
            >
              Limpar
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={!canApply} onClick={() => commit(false)}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Rascunho numérico de filtro de coluna: vazio = null (sem limite);
 * negativo ou não numérico é sinalizado para a UI (nunca chega à URL).
 */
function parseNumberDraft(draft: string): { value: number | null; invalid: boolean } {
  const trimmed = draft.trim();
  if (trimmed === "") return { value: null, invalid: false };
  const parsed = toNumber(trimmed);
  if (parsed === null || parsed < 0) return { value: null, invalid: true };
  return { value: parsed, invalid: false };
}

export interface NumericRangeFilterProps {
  /** Contexto do título/aria do funil, ex.: "quantidade". */
  context: string;
  /** Rótulo dos campos no painel, ex.: "Qtd.". */
  column: string;
  /** Faixa vigente (null = lado aberto). */
  min: number | null;
  max: number | null;
  /** Aplica a faixa na URL (a tela decide os parâmetros). */
  onApply: (min: number | null, max: number | null) => void;
  /** Prefixo dos ids dos campos (cada tela tem os seus). */
  idPrefix: string;
  /** Passo dos campos (padrão "1"; pesos usam "0.001"). */
  step?: string;
}

/**
 * Filtro de faixa numérica (De/Até) por cabeçalho de coluna — Qtd.,
 * Peso etc. Mesmo padrão do DeliveryPeriodPopover: rascunho local e a
 * URL só muda em "Aplicar"/Enter (o blur não navega).
 */
export function NumericRangeFilter({
  context,
  column,
  min,
  max,
  onApply,
  idPrefix,
  step = "1",
}: NumericRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draftMin, setDraftMin] = useState(min?.toString() ?? "");
  const [draftMax, setDraftMax] = useState(max?.toString() ?? "");
  const [synced, setSynced] = useState({ min, max });
  // Última faixa enviada à URL: o eco da navegação não pode reescrever o
  // rascunho do campo que o usuário está digitando em seguida.
  const [sent, setSent] = useState({ min, max });

  if (synced.min !== min || synced.max !== max) {
    setSynced({ min, max });
    const echo = sent.min === min && sent.max === max;
    if (!echo) {
      setSent({ min, max });
      setDraftMin(min?.toString() ?? "");
      setDraftMax(max?.toString() ?? "");
    }
  }

  const active = min !== null || max !== null;
  const parsedMin = parseNumberDraft(draftMin);
  const parsedMax = parseNumberDraft(draftMax);
  const invalid = parsedMin.invalid || parsedMax.invalid;
  const inverted =
    !invalid && parsedMin.value !== null && parsedMax.value !== null && parsedMin.value > parsedMax.value;

  const commit = () => {
    if (invalid || inverted) return;
    if (sent.min === parsedMin.value && sent.max === parsedMax.value) {
      setOpen(false);
      return;
    }
    setSent({ min: parsedMin.value, max: parsedMax.value });
    onApply(parsedMin.value, parsedMax.value);
    setOpen(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Cada abertura parte da faixa vigente — descartar edições abandonadas.
    if (next) {
      setDraftMin(min?.toString() ?? "");
      setDraftMax(max?.toString() ?? "");
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-de`} className="text-xs text-muted-foreground">
              {column} — de
            </Label>
            <Input
              id={`${idPrefix}-de`}
              type="text"
              inputMode="decimal"
              step={step}
              value={draftMin}
              onChange={(event) => setDraftMin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              placeholder="Mínimo"
              autoComplete="off"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-ate`} className="text-xs text-muted-foreground">
              {column} — até
            </Label>
            <Input
              id={`${idPrefix}-ate`}
              type="text"
              inputMode="decimal"
              step={step}
              value={draftMax}
              onChange={(event) => setDraftMax(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              placeholder="Máximo"
              autoComplete="off"
              className="h-8"
            />
          </div>
        </div>

        {invalid ? (
          <p className="text-xs text-destructive" role="status">
            Informe números válidos (sem negativos).
          </p>
        ) : inverted ? (
          <p className="text-xs text-destructive" role="status">
            O mínimo é maior que o máximo.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {active ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSent({ min: null, max: null });
                setDraftMin("");
                setDraftMax("");
                onApply(null, null);
                setOpen(false);
              }}
            >
              Limpar
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={invalid || inverted} onClick={commit}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface SeqEqualityFilterProps {
  /** Contexto do título/aria do funil, ex.: "sequência de fabricação". */
  context: string;
  /** Sequência vigente (null = sem filtro). */
  value: number | null;
  /** Aplica a sequência na URL (null limpa o filtro). */
  onApply: (value: number | null) => void;
  /** Prefixo dos ids dos campos (cada tela tem os seus). */
  idPrefix: string;
}

/**
 * Filtro da coluna Seq. por IGUALDADE (seq = N, 038): inteiro >= 1 —
 * o número é exclusivo por OF, então o filtro devolve a linha do
 * planejamento. Mesmo padrão dos demais popovers de cabeçalho.
 */
export function SeqEqualityFilter({ context, value, onApply, idPrefix }: SeqEqualityFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? "");
  const [synced, setSynced] = useState(value);
  // Último valor enviado à URL — o eco da navegação não reescreve o rascunho.
  const [sent, setSent] = useState(value);

  if (synced !== value) {
    setSynced(value);
    if (sent !== value) {
      setSent(value);
      setDraft(value?.toString() ?? "");
    }
  }

  const active = value !== null;
  const trimmed = draft.trim();
  let parsed: number | null = null;
  let invalid = false;
  if (trimmed !== "") {
    if (/^\d{1,6}$/.test(trimmed) && Number.parseInt(trimmed, 10) >= 1) {
      parsed = Number.parseInt(trimmed, 10);
    } else {
      invalid = true;
    }
  }

  const commit = () => {
    if (invalid) return;
    if (sent === parsed) {
      setOpen(false);
      return;
    }
    setSent(parsed);
    onApply(parsed);
    setOpen(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(value?.toString() ?? "");
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-seq`} className="text-xs text-muted-foreground">
            Seq. — igual a
          </Label>
          <Input
            id={`${idPrefix}-seq`}
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            placeholder="Ex.: 7"
            autoComplete="off"
            className="h-8"
          />
        </div>

        {invalid ? (
          <p className="text-xs text-destructive" role="status">
            Digite um número inteiro maior que zero.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {active ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSent(null);
                setDraft("");
                onApply(null);
                setOpen(false);
              }}
            >
              Limpar
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={invalid} onClick={commit}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
