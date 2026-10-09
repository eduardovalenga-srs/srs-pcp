"use client";

import { Plus, Trash2 } from "lucide-react";

import { MATERIAL_UNIT_OPTIONS } from "@/lib/constants/materials";
import type { MaterialInput } from "@/lib/validators/material.schema";
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

interface MaterialsEditorProps {
  value: MaterialInput[];
  onChange: (value: MaterialInput[]) => void;
  disabled?: boolean;
  /** Prefixo dos ids dos campos (evita duplicar ids entre itens). */
  idPrefix?: string;
}

const EMPTY_ROW: MaterialInput = { description: "", quantity: "", unit: "UN", notes: "" };

/**
 * Lista editável de matéria-prima de um sub-item (controlado).
 * Usado no formulário do pedido (react-hook-form) e na tela de detalhes.
 */
export function MaterialsEditor({
  value,
  onChange,
  disabled = false,
  idPrefix = "material",
}: MaterialsEditorProps) {
  const rows = value ?? [];

  const update = (index: number, patch: Partial<MaterialInput>) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const remove = (index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="space-y-2">
      <div
        className="hidden gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_6rem_minmax(0,1fr)_2rem]"
        aria-hidden
      >
        <span className="text-xs font-medium text-muted-foreground">Material</span>
        <span className="text-xs font-medium text-muted-foreground">Quantidade</span>
        <span className="text-xs font-medium text-muted-foreground">Unidade</span>
        <span className="text-xs font-medium text-muted-foreground">Obs.</span>
        <span />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum material cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={index}
              className="grid gap-2 rounded border bg-muted/30 p-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_6rem_minmax(0,1fr)_2rem] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
            >
              <div className="space-y-1">
                <Label className="sm:hidden" htmlFor={`${idPrefix}-desc-${index}`}>
                  Material
                </Label>
                <Input
                  id={`${idPrefix}-desc-${index}`}
                  value={row.description ?? ""}
                  onChange={(event) => update(index, { description: event.target.value })}
                  placeholder="Ex.: Chapa xadrez 3 mm"
                  disabled={disabled}
                  maxLength={200}
                />
              </div>

              <div className="space-y-1">
                <Label className="sm:hidden" htmlFor={`${idPrefix}-qtd-${index}`}>
                  Quantidade
                </Label>
                <Input
                  id={`${idPrefix}-qtd-${index}`}
                  inputMode="decimal"
                  value={row.quantity === undefined || row.quantity === null ? "" : String(row.quantity)}
                  onChange={(event) => update(index, { quantity: event.target.value })}
                  placeholder="0"
                  disabled={disabled}
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <Label className="sm:hidden">Unidade</Label>
                <Select
                  value={row.unit}
                  onValueChange={(unit) => update(index, { unit: unit as MaterialInput["unit"] })}
                  disabled={disabled}
                >
                  <SelectTrigger aria-label="Unidade" className="w-full">
                    <SelectValue placeholder="Unidade" />
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

              <div className="space-y-1">
                <Label className="sm:hidden" htmlFor={`${idPrefix}-obs-${index}`}>
                  Observações
                </Label>
                <Input
                  id={`${idPrefix}-obs-${index}`}
                  value={row.notes ?? ""}
                  onChange={(event) => update(index, { notes: event.target.value })}
                  placeholder="Opcional"
                  disabled={disabled}
                  maxLength={300}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover material ${row.description || index + 1}`}
                  title="Remover material"
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
        onClick={() => onChange([...rows, { ...EMPTY_ROW }])}
        disabled={disabled}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Adicionar material
      </Button>
    </div>
  );
}
