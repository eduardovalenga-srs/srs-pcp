"use client";

import { Plus, Trash2 } from "lucide-react";

import {
  MATERIAL_UNIT_LABELS,
  MATERIAL_UNIT_OPTIONS,
  type MaterialUnit,
} from "@/lib/constants/materials";
import { formatNumber, parseQuantity } from "@/lib/utils/formatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Linha DIGITADA de material fora da OF (060). O `id` é só a chave de
 * renderização no React — não vai ao banco.
 */
export interface MpFreeItemDraft {
  id: string;
  description: string;
  unit: MaterialUnit;
  quantity: string;
}

let draftSeq = 0;

/** Nova linha vazia (unidade padrão kg). */
export function newMpFreeItem(): MpFreeItemDraft {
  draftSeq += 1;
  return { id: `mp-free-${draftSeq}`, description: "", unit: "KG", quantity: "" };
}

/** Linha em que o clerk digitou algo (descrição ou quantidade). */
export function isFilledMpFreeItem(item: MpFreeItemDraft): boolean {
  return item.description.trim() !== "" || item.quantity.trim() !== "";
}

function freeItemQuantity(item: MpFreeItemDraft): number {
  return parseQuantity(item.quantity) ?? 0;
}

/**
 * Itens VÁLIDOS da lista — o payload da nota (descrição + unidade +
 * quantidade). Linha vazia (nunca tocada) não entra; linha começada e
 * incompleta é barrada por `invalidMpFreeItemMessage` antes de salvar.
 */
export function markedMpFreeItems(
  items: readonly MpFreeItemDraft[],
): { description: string; unit: MaterialUnit; quantity: number }[] {
  return items.flatMap((item) => {
    const description = item.description.trim();
    const quantity = freeItemQuantity(item);
    return description !== "" && quantity > 0
      ? [{ description, unit: item.unit, quantity }]
      : [];
  });
}

/**
 * Primeira linha começada e inválida (ou material repetido), em texto
 * para o toast; `null` quando a lista está ok. Valida o que o banco
 * exige: descrição, quantidade > 0 e sem repetir descrição+unidade.
 */
export function invalidMpFreeItemMessage(
  items: readonly MpFreeItemDraft[],
): string | null {
  const seen = new Set<string>();

  for (const [index, item] of items.entries()) {
    if (!isFilledMpFreeItem(item)) continue;

    const description = item.description.trim();
    if (description === "") {
      return `Item ${index + 1} fora da OF: informe a matéria-prima.`;
    }
    if (freeItemQuantity(item) <= 0) {
      return `Item ${index + 1} fora da OF: informe a quantidade.`;
    }

    const key = `${description.toUpperCase()}::${item.unit}`;
    if (seen.has(key)) {
      return `Matéria-prima repetida fora da OF: ${description}.`;
    }
    seen.add(key);
  }

  return null;
}

/** "12,5 kg" — quantidade + rótulo da unidade de medida. */
export function formatMpFreeItemQuantity(quantity: number, unit: string): string {
  const label = MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
  return `${formatNumber(quantity, 3)} ${label}`;
}

interface MpFreeItemsEditorProps {
  value: MpFreeItemDraft[];
  onChange: (value: MpFreeItemDraft[]) => void;
  disabled?: boolean;
}

/**
 * Lista editável (controlada) de material recebido FORA da OF:
 * descrição + unidade de medida + quantidade. É opcional na nota e
 * NÃO afeta o saldo da OF nem o espelho da coluna MP — só registro.
 */
export function MpFreeItemsEditor({ value, onChange, disabled = false }: MpFreeItemsEditorProps) {
  const rows = value ?? [];

  const update = (index: number, patch: Partial<MpFreeItemDraft>) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const remove = (index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="space-y-2">
      <div
        className="hidden gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_7rem_2rem]"
        aria-hidden
      >
        <span className="text-xs font-medium text-muted-foreground">Matéria-prima</span>
        <span className="text-xs font-medium text-muted-foreground">Quantidade</span>
        <span className="text-xs font-medium text-muted-foreground">UM</span>
        <span />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum material fora da OF nesta nota.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="grid gap-2 rounded border bg-muted/30 p-2 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_2rem] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
            >
              <div className="space-y-1">
                <Label className="sm:hidden" htmlFor={`mp-free-desc-${row.id}`}>
                  Matéria-prima
                </Label>
                <Input
                  id={`mp-free-desc-${row.id}`}
                  value={row.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                  placeholder="Ex.: Chapa xadrez 3 mm"
                  disabled={disabled}
                  maxLength={200}
                />
              </div>

              <div className="space-y-1">
                <Label className="sm:hidden" htmlFor={`mp-free-qtd-${row.id}`}>
                  Quantidade
                </Label>
                <Input
                  id={`mp-free-qtd-${row.id}`}
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event) => update(index, { quantity: event.target.value })}
                  placeholder="0"
                  disabled={disabled}
                  className="tabular-nums"
                  aria-label={`Quantidade de ${row.description || `item ${index + 1}`}`}
                />
              </div>

              <div className="space-y-1">
                <Label className="sm:hidden">Unidade de medida</Label>
                <Select
                  value={row.unit}
                  onValueChange={(unit) => update(index, { unit: unit as MaterialUnit })}
                  disabled={disabled}
                >
                  <SelectTrigger aria-label="Unidade de medida" className="w-full">
                    <SelectValue placeholder="UM" />
                  </SelectTrigger>
                  <SelectContent>
                    {MATERIAL_UNIT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover item ${row.description || index + 1} fora da OF`}
                  title="Remover item"
                  onClick={() => remove(index)}
                  disabled={disabled}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, newMpFreeItem()])}
        disabled={disabled}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Adicionar item fora da OF
      </Button>
    </div>
  );
}
