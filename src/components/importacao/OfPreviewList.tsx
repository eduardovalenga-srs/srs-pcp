"use client";

import { AlertTriangle, CircleAlert, Minus, PlusCircle, RefreshCw } from "lucide-react";

import {
  IMPORT_DECISION_DESCRIPTIONS,
  IMPORT_DECISION_LABELS,
  IMPORT_DECISIONS,
  type ImportDecision,
} from "@/lib/constants/import";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants/orders";
import type { ImportPreview, OfDecisionMap, OfDifference, OfPreview, RowStatus } from "@/lib/types/import";
import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * Prévia hierárquica da importação: uma cartela por OF com estrutura
 * (pais -> filhos -> matéria-prima), erros/alertas e, quando a OF já
 * existe, as diferenças campo a campo (sistema x arquivo) com a pergunta
 * o que fazer — nenhuma OF é sobrescrita sem escolha explícita.
 */

const STATUS_META: Record<RowStatus, { label: string; variant: BadgeProps["variant"] }> = {
  VALID: { label: "Pronta", variant: "success" },
  WARNING: { label: "Com alertas", variant: "warning" },
  ERROR: { label: "Com erros", variant: "destructive" },
};

const KIND_META: Record<OfDifference["kind"], { label: string; className: string }> = {
  changed: { label: "Alterado", className: "text-amber-700 dark:text-amber-400" },
  added: { label: "Novo", className: "text-emerald-700 dark:text-emerald-400" },
  removed: { label: "Removido", className: "text-red-700 dark:text-red-400" },
};

const SCOPE_LABELS: Record<OfDifference["scope"], string> = {
  order: "OF",
  parent: "Item pai",
  child: "Item filho",
};

interface OfPreviewListProps {
  preview: ImportPreview;
  decisions: OfDecisionMap;
  onDecisionChange: (code: string, decision: ImportDecision) => void;
  disabled?: boolean;
}

export function OfPreviewList({ preview, decisions, onDecisionChange, disabled = false }: OfPreviewListProps) {
  return (
    <div className="space-y-3">
      {preview.orders.map((entry) => (
        <OfCard
          key={`${entry.order.code}-${entry.sourceRow}`}
          entry={entry}
          decision={decisions[entry.order.code]}
          onDecisionChange={(decision) => onDecisionChange(entry.order.code, decision)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface OfCardProps {
  entry: OfPreview;
  decision: ImportDecision | undefined;
  onDecisionChange: (decision: ImportDecision) => void;
  disabled: boolean;
}

function OfCard({ entry, decision, onDecisionChange, disabled }: OfCardProps) {
  const status = STATUS_META[entry.status];
  const isNew = !entry.exists;

  return (
    <article className="rounded border bg-card p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold tabular-nums">{entry.order.code}</h3>
        <Badge variant={status.variant}>{status.label}</Badge>
        {isNew ? (
          <Badge variant="outline">
            <PlusCircle aria-hidden className="h-3 w-3" /> Nova
          </Badge>
        ) : (
          <Badge variant="secondary">
            <RefreshCw aria-hidden className="h-3 w-3" /> Existe no sistema
            {entry.existingStatus
              ? ` — ${ORDER_STATUS_LABELS[entry.existingStatus as OrderStatus] ?? entry.existingStatus}`
              : ""}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {entry.counts.parents} pai(s) · {entry.counts.children} filho(s) · {entry.counts.materials} MP
        </span>
      </header>

      <p className="mt-1 text-xs text-muted-foreground">
        {entry.order.description || "Sem descrição"} · entrega{" "}
        {entry.order.deliveryDate.split("-").reverse().join("/")} · linha {entry.sourceRow}
      </p>

      {entry.issues.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {entry.issues.map((issue, index) => (
            <li
              key={`${issue.where}-${issue.column ?? ""}-${index}`}
              className={`flex items-start gap-1.5 rounded border px-2 py-1 text-xs ${
                issue.severity === "error"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              {issue.severity === "error" ? (
                <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>
                <strong className="font-semibold">{issue.where}</strong>
                {issue.column ? <code className="mx-1 text-[11px] opacity-80">{issue.column}</code> : null}
                {" — "}
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Diferenças + decisão (somente OF existente sem erro) */}
      {entry.exists && entry.status !== "ERROR" ? (
        <div className="mt-3 space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Diferenças (sistema × arquivo)</h4>
          {entry.differences.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma diferença entre o que está no sistema e o que veio no arquivo.
            </p>
          ) : (
            <div className="overflow-auto rounded border">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Diferenças entre sistema e arquivo para a OF {entry.order.code}
                </caption>
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th scope="col" className="h-8 px-2 text-left font-semibold uppercase tracking-wide">
                      Escopo
                    </th>
                    <th scope="col" className="h-8 px-2 text-left font-semibold uppercase tracking-wide">
                      Campo
                    </th>
                    <th scope="col" className="h-8 px-2 text-left font-semibold uppercase tracking-wide">
                      Sistema
                    </th>
                    <th scope="col" className="h-8 px-2 text-left font-semibold uppercase tracking-wide">
                      Arquivo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entry.differences.map((diff, index) => {
                    const kind = KIND_META[diff.kind];
                    return (
                      <tr key={`${diff.scope}-${diff.code}-${diff.field}-${index}`} className="border-b last:border-0">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="text-muted-foreground">{SCOPE_LABELS[diff.scope]}</span>{" "}
                          <span className="font-medium tabular-nums">{diff.code}</span>
                          {diff.parentCode ? (
                            <span className="block text-[11px] text-muted-foreground">de {diff.parentCode}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className={`font-semibold ${kind.className}`}>{kind.label}</span>
                          <span className="block">{diff.label}</span>
                        </td>
                        <td className="max-w-[22ch] px-2 py-1.5 break-words">{diff.current ?? "—"}</td>
                        <td className="max-w-[22ch] px-2 py-1.5 break-words">
                          {diff.incoming ?? "—"}
                          {diff.kind === "removed" && diff.hasProgress ? (
                            <span className="block font-semibold text-destructive">Tinha progresso</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <fieldset className="space-y-1.5" disabled={disabled}>
            <legend className="text-xs font-semibold uppercase text-muted-foreground">
              O que fazer com esta OF?
            </legend>
            {IMPORT_DECISIONS.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name={`of-decision-${entry.order.code}`}
                  value={value}
                  checked={decision === value}
                  onChange={() => onDecisionChange(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">{IMPORT_DECISION_LABELS[value]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {IMPORT_DECISION_DESCRIPTIONS[value]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}

      {/* Estrutura que será importada */}
      {entry.order.parents.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">
            Estrutura do arquivo
          </summary>
          <ul className="mt-2 space-y-2">
            {entry.order.parents.map((parent) => (
              <li key={parent.code} className="rounded border bg-muted/20 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="tabular-nums">
                    {parent.code}
                  </Badge>
                  <span className="font-medium">{parent.description}</span>
                  <span className="text-muted-foreground tabular-nums">
                    qtd. {parent.quantity} · {parent.unitWeightKg ?? "—"} kg · total {parent.totalWeightKg ?? "—"} kg
                  </span>
                  {parent.family ? <span className="text-muted-foreground">TP {parent.family}</span> : null}
                </div>
                {parent.materials.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    MP: {parent.materials.map((material) => material.description).join("; ")}
                  </p>
                ) : null}
                {parent.children.length > 0 ? (
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-auto pl-2">
                    {parent.children.map((child) => (
                      <li
                        key={child.code}
                        className="flex flex-wrap items-center gap-2 rounded border bg-card px-1.5 py-1 text-xs"
                      >
                        <span className="font-medium tabular-nums">{child.code}</span>
                        <span className="text-muted-foreground">{child.description}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          qtd. {child.quantity} · {child.unitWeightKg ?? "—"} kg
                        </span>
                        {child.materials[0] ? (
                          <span className="w-full truncate text-muted-foreground">
                            MP: {child.materials[0].description}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Sem itens filhos (material direto no pai).</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {entry.status === "ERROR" ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-destructive">
          <Minus aria-hidden className="h-3.5 w-3.5" /> Esta OF ficará fora da importação até os erros acima serem
          corrigidos no arquivo.
        </p>
      ) : null}
    </article>
  );
}
