"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteProductGroupAction,
  saveProductGroupAction,
} from "@/lib/actions/product-groups.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProcessDefinition } from "@/lib/types/production";
import type { ProductGroupDefinition, ProductFactory } from "@/lib/types/product-group";
import {
  PRODUCT_CAPACITY_UNITS,
  saveProductGroupSchema,
  type ProductCapacityUnit,
  type SaveProductGroupInput,
} from "@/lib/validators/product-group.schema";
import { PROCESS_FACTORIES } from "@/lib/validators/process.schema";
import { WEIGHT_DECIMALS } from "@/lib/utils/formatting";

const UNIT_LABELS: Record<ProductCapacityUnit, string> = {
  KG: "kg",
  M2: "m²",
  UNIDADES: "un",
};

/** Capacidade inicial dos processos ainda não preenchidos. */
const DEFAULT_CAPACITY = "0";

type CapacityDraft = {
  key: string;
  factory: ProductFactory;
  processId: string;
  unit: ProductCapacityUnit;
  capacity: string;
};

type GroupDraft = {
  key: string;
  id: number | null;
  groupType: string | null;
  familyDescription: string;
  familyAbbreviation: string;
  capacities: CapacityDraft[];
  editing: boolean;
  error: string;
};

interface ProductGroupsCatalogProps {
  groups: ProductGroupDefinition[];
  processes: ProcessDefinition[];
  canManage: boolean;
}

function capacitiesForGroup(
  groupKey: string,
  processes: ProcessDefinition[],
  existing: ProductGroupDefinition["capacities"] = [],
): CapacityDraft[] {
  const rows = existing.map((capacity, index) => ({
    key: `${groupKey}-capacity-${index}`,
    factory: capacity.factory,
    processId: capacity.processId,
    unit: capacity.unit,
    capacity: String(capacity.capacity),
  }));
  const covered = new Set(rows.map((row) => row.processId));
  for (const process of processes) {
    if (covered.has(process.id) || !PROCESS_FACTORIES.includes(process.location as ProductFactory)) {
      continue;
    }
    rows.push({
      key: `${groupKey}-capacity-${rows.length}`,
      factory: process.location as ProductFactory,
      processId: process.id,
      unit: "KG",
      capacity: DEFAULT_CAPACITY,
    });
  }
  return rows;
}

function groupDraftsFrom(
  groups: ProductGroupDefinition[],
  processes: ProcessDefinition[],
): GroupDraft[] {
  return groups.map((group) => ({
    key: `group-${group.id}`,
    id: group.id,
    groupType: group.groupType,
    familyDescription: group.familyDescription,
    familyAbbreviation: group.familyAbbreviation,
    capacities: capacitiesForGroup(`group-${group.id}`, processes, group.capacities),
    editing: false,
    error: "",
  }));
}

function emptyGroupDraft(key: string, processes: ProcessDefinition[]): GroupDraft {
  return {
    key,
    id: null,
    groupType: null,
    familyDescription: "",
    familyAbbreviation: "",
    capacities: capacitiesForGroup(key, processes),
    editing: true,
    error: "",
  };
}

function formatCapacity(value: number, unit: ProductCapacityUnit): string {
  // KG/dia é peso: 2 casas (migração 075). m²/unidades mantêm a precisão.
  const digits = unit === "KG" ? WEIGHT_DECIMALS : 3;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value)} ${UNIT_LABELS[unit]}`;
}

/**
 * Aplica uma edição no rascunho do grupo. `error` é limpo primeiro e o
 * patch vem depois — assim uma mensagem de validação/salvamento passada
 * no patch é preservada (antes o `error: ""` final apagava o aviso e o
 * clique em “Salvar” parecia não fazer nada).
 */
export function mergeGroupDraft<T extends { error: string }>(draft: T, patch: Partial<T>): T {
  return { ...draft, error: "", ...patch };
}

export function ProductGroupsCatalog({
  groups,
  processes,
  canManage,
}: ProductGroupsCatalogProps) {
  const orderedProcesses = [...processes].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
  const factoryProcesses = {
    "Fábrica 1": orderedProcesses.filter((process) => process.location === "Fábrica 1"),
    "Fábrica 2": orderedProcesses.filter((process) => process.location === "Fábrica 2"),
  } satisfies Record<ProductFactory, ProcessDefinition[]>;
  const allFactoryProcesses = PROCESS_FACTORIES.flatMap((factory) => factoryProcesses[factory]);
  const unmappedProcesses = processes.filter(
    (process) => process.location !== "Fábrica 1" && process.location !== "Fábrica 2",
  );

  const [drafts, setDrafts] = useState(() => {
    const saved = groupDraftsFrom(groups, orderedProcesses);
    return saved.length > 0 || !canManage ? saved : [emptyGroupDraft("new-group-0", orderedProcesses)];
  });
  const [previousCatalog, setPreviousCatalog] = useState({ groups, processes });
  const [nextKey, setNextKey] = useState(groups.length === 0 && canManage ? 1 : 0);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Após salvar, sincroniza os grupos persistidos sem descartar novas linhas
  // que o usuário ainda esteja preenchendo.
  if (previousCatalog.groups !== groups || previousCatalog.processes !== processes) {
    setPreviousCatalog({ groups, processes });
    setDrafts((current) => [
      ...groupDraftsFrom(groups, orderedProcesses),
      ...current.filter((draft) => draft.id === null),
    ]);
  }

  const addGroup = () => {
    const key = `new-group-${nextKey}`;
    setDrafts((current) => [...current, emptyGroupDraft(key, orderedProcesses)]);
    setNextKey((value) => value + 1);
  };

  const updateGroup = (key: string, patch: Partial<GroupDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? mergeGroupDraft(draft, patch) : draft)),
    );
  };

  const removeNewGroup = (key: string) => {
    setDrafts((current) => current.filter((draft) => draft.key !== key || draft.id !== null));
  };

  const startEdit = (key: string) => {
    updateGroup(key, { editing: true });
  };

  const cancelEdit = (draft: GroupDraft) => {
    const saved = groups.find((group) => group.id === draft.id);
    if (!saved) {
      updateGroup(draft.key, { editing: false, error: "" });
      return;
    }
    const restored = groupDraftsFrom([saved], orderedProcesses)[0];
    setDrafts((current) =>
      current.map((row) => (row.key === draft.key ? { ...restored, key: draft.key } : row)),
    );
  };

  const deleteGroup = async (draft: GroupDraft) => {
    if (savingKey || draft.id === null) return;
    const label = draft.groupType ?? `${draft.id}-${draft.familyAbbreviation}`;
    const confirmed = window.confirm(
      `Excluir o grupo ${label}? As OFs que usam esta família ficarão sem família no sequenciamento.`,
    );
    if (!confirmed) return;

    setSavingKey(draft.key);
    try {
      const result = await deleteProductGroupAction(draft.id);
      if (!result.success) {
        updateGroup(draft.key, { error: result.message });
        toast.error(result.message);
        return;
      }
      setDrafts((current) => current.filter((row) => row.key !== draft.key));
      toast.success(result.message);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível excluir o grupo de produtos.";
      updateGroup(draft.key, { error: message });
      toast.error(message);
    } finally {
      setSavingKey(null);
    }
  };

  const updateCapacity = (
    groupKey: string,
    capacityKey: string,
    patch: Partial<CapacityDraft>,
  ) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === groupKey
          ? {
              ...draft,
              error: "",
              capacities: draft.capacities.map((capacity) =>
                capacity.key === capacityKey ? { ...capacity, ...patch } : capacity,
              ),
            }
          : draft,
      ),
    );
  };

  const addCapacityUnit = (draft: GroupDraft, factory: ProductFactory, processId: string) => {
    const usedUnits = draft.capacities
      .filter((capacity) => capacity.factory === factory && capacity.processId === processId)
      .map((capacity) => capacity.unit);
    const unit = PRODUCT_CAPACITY_UNITS.find((candidate) => !usedUnits.includes(candidate));
    if (!unit) return;
    const key = `${draft.key}-capacity-${nextKey}`;
    setDrafts((current) =>
      current.map((row) =>
        row.key === draft.key
          ? {
              ...row,
              capacities: [
                ...row.capacities,
                { key, factory, processId, unit, capacity: DEFAULT_CAPACITY },
              ],
            }
          : row,
      ),
    );
    setNextKey((value) => value + 1);
  };

  const removeCapacityUnit = (
    draft: GroupDraft,
    capacityKey: string,
    factory: ProductFactory,
    processId: string,
  ) => {
    const cellRows = draft.capacities.filter(
      (capacity) => capacity.factory === factory && capacity.processId === processId,
    );
    if (cellRows.length <= 1) return;
    setDrafts((current) =>
      current.map((row) =>
        row.key === draft.key
          ? {
              ...row,
              capacities: row.capacities.filter((capacity) => capacity.key !== capacityKey),
            }
          : row,
      ),
    );
  };

  const saveGroup = async (draft: GroupDraft) => {
    if (savingKey) return;
    const payload: SaveProductGroupInput = {
      id: draft.id,
      familyDescription: draft.familyDescription,
      familyAbbreviation: draft.familyAbbreviation,
      capacities: draft.capacities.map(({ factory, processId, unit, capacity }) => ({
        factory,
        processId,
        unit,
        capacity,
      })),
    };

    // Mensagem amigável antes do zod: aponta os processos sem capacidade,
    // que são o motivo mais comum de o salvamento não avançar.
    const semCapacidade = draft.capacities.filter((capacity) => capacity.capacity.trim() === "");
    if (semCapacidade.length > 0) {
      const nomes = semCapacidade.map(
        (capacity) =>
          orderedProcesses.find((process) => process.id === capacity.processId)?.name ??
          "processo sem nome",
      );
      const message = `Informe a capacidade dos processos: ${nomes.join(", ")}.`;
      updateGroup(draft.key, { error: message });
      toast.error(message);
      return;
    }

    const parsed = saveProductGroupSchema.safeParse(payload);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Confira os dados informados.";
      updateGroup(draft.key, { error: message });
      toast.error(message);
      return;
    }

    setSavingKey(draft.key);
    try {
      const result = await saveProductGroupAction(parsed.data);
      if (!result.success) {
        updateGroup(draft.key, { error: result.message });
        toast.error(result.message);
        return;
      }
      setDrafts((current) =>
        current.map((row) =>
          row.key === draft.key
            ? {
                ...row,
                id: result.id ?? row.id,
                groupType: result.groupType ?? row.groupType,
                editing: false,
                error: "",
              }
            : row,
        ),
      );
      toast.success(result.message);
    } catch (error) {
      // Falha inesperada (rede/Server Action): nunca deixar o clique mudo.
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível salvar o grupo de produtos.";
      updateGroup(draft.key, { error: message });
      toast.error(message);
    } finally {
      setSavingKey(null);
    }
  };

  const renderCapacityCell = (
    draft: GroupDraft,
    process: ProcessDefinition,
    editable: boolean,
  ) => {
    const cellRows = draft.capacities.filter(
      (capacity) => capacity.processId === process.id,
    );
    if (!editable) {
      return (
        <ul className="space-y-1">
          {cellRows.length > 0
            ? cellRows.map((capacity) => (
                <li key={capacity.key}>{formatCapacity(Number(capacity.capacity), capacity.unit)}</li>
              ))
            : <li className="text-muted-foreground">—</li>}
        </ul>
      );
    }

    const usedUnits = cellRows.map((capacity) => capacity.unit);
    const canAddUnit = PRODUCT_CAPACITY_UNITS.some((unit) => !usedUnits.includes(unit));
    return (
      <div className="min-w-[160px] space-y-1">
        {cellRows.map((capacity) => {
          const otherUnits = cellRows
            .filter((candidate) => candidate.key !== capacity.key)
            .map((candidate) => candidate.unit);
          return (
            <div
              key={capacity.key}
              className="grid grid-cols-[max-content_5ch_22px] items-end gap-0.5"
            >
              <div className="space-y-1">
                <Label className="text-[10px]" htmlFor={`${capacity.key}-unit`}>
                  Un.
                </Label>
                <Select
                  value={capacity.unit}
                  disabled={savingKey === draft.key}
                  onValueChange={(unit) =>
                    updateCapacity(draft.key, capacity.key, { unit: unit as ProductCapacityUnit })
                  }
                >
                  <SelectTrigger
                    id={`${capacity.key}-unit`}
                    className="h-7 w-fit min-w-12 px-1 text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CAPACITY_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit} disabled={otherUnits.includes(unit)}>
                        {UNIT_LABELS[unit]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]" htmlFor={`${capacity.key}-value`}>
                  Cap.
                </Label>
                <Input
                  id={`${capacity.key}-value`}
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex.: 250"
                  className="h-7 w-[5ch] min-w-0 px-1 text-[11px]"
                  value={capacity.capacity}
                  disabled={savingKey === draft.key}
                  onChange={(event) =>
                    updateCapacity(draft.key, capacity.key, { capacity: event.target.value })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-[22px]"
                disabled={savingKey === draft.key || cellRows.length <= 1}
                onClick={() =>
                  removeCapacityUnit(draft, capacity.key, process.location as ProductFactory, process.id)
                }
                aria-label={`Remover unidade ${UNIT_LABELS[capacity.unit]} do processo ${process.name}`}
                title="Remover unidade"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          );
        })}
        {cellRows.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            disabled={!canAddUnit || savingKey === draft.key}
            onClick={() =>
              addCapacityUnit(draft, process.location as ProductFactory, process.id)
            }
          >
            <Plus className="h-3 w-3" aria-hidden />
            Un.
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      {canManage && unmappedProcesses.length > 0 ? (
        <p className="rounded border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          Associe todos os processos a uma fábrica antes de cadastrar capacidades:{" "}
          {unmappedProcesses.map((process) => process.code).join(", ")}.
        </p>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Preencha a capacidade de <strong>todos</strong> os processos. O sequenciamento usa a
            capacidade em <strong>kg/dia</strong>.
          </p>
          <Button type="button" size="sm" onClick={addGroup} disabled={unmappedProcesses.length > 0}>
            <Plus className="h-4 w-4" aria-hidden />
            Adicionar registro
          </Button>
        </div>
      ) : null}

      {drafts.length === 0 ? (
        <p className="rounded border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum grupo cadastrado. Use “Adicionar registro” para incluir o primeiro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              Grupos de produto e capacidades por processo e fábrica
            </caption>
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wide">
                  <th scope="col" rowSpan={2} className="sticky left-0 z-20 min-w-32 max-w-32 border-b bg-muted/90 px-2 py-2">
                  Família
                </th>
                <th scope="col" rowSpan={2} className="sticky left-32 z-20 min-w-20 max-w-20 border-b bg-muted/90 px-2 py-2">
                  Abrv
                </th>
                {factoryProcesses["Fábrica 1"].length > 0 ? (
                  <th
                    scope="colgroup"
                    colSpan={factoryProcesses["Fábrica 1"].length}
                    className="border-b border-l px-3 py-2 text-center"
                  >
                    Fábrica 1
                  </th>
                ) : null}
                {factoryProcesses["Fábrica 2"].length > 0 ? (
                  <th
                    scope="colgroup"
                    colSpan={factoryProcesses["Fábrica 2"].length}
                    className="border-b border-l px-3 py-2 text-center"
                  >
                    Fábrica 2
                  </th>
                ) : null}
                {canManage ? (
                  <th scope="col" rowSpan={2} className="border-b border-l px-3 py-2 text-right">
                    Ações
                  </th>
                ) : null}
              </tr>
              <tr className="bg-muted/30 text-left text-xs">
                {allFactoryProcesses.map((process) => (
                  <th
                    scope="col"
                    key={process.id}
                    className="min-w-[160px] border-b border-l px-2 py-2"
                  >
                    <span className="block font-semibold">{process.name}</span>
                    <span className="text-muted-foreground">{process.code}</span>
                    {!process.active ? <span className="ml-1 text-muted-foreground">(inativo)</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const editable = canManage && draft.editing;
                return (
                  <tr key={draft.key} className="align-top hover:bg-muted/20">
                    <td className="sticky left-0 z-10 border-b bg-card px-2 py-2">
                      {editable ? (
                        <Input
                          aria-label="Família"
                          maxLength={120}
                          className="h-8 w-28 px-1.5 text-xs"
                          placeholder="Família"
                          value={draft.familyDescription}
                          disabled={savingKey === draft.key}
                          onChange={(event) =>
                            updateGroup(draft.key, { familyDescription: event.target.value })
                          }
                        />
                      ) : (
                        draft.familyDescription
                      )}
                    </td>
                    <td className="sticky left-32 z-10 border-b bg-card px-1.5 py-2">
                      {editable ? (
                        <Input
                          aria-label="Abrv"
                          maxLength={3}
                          autoCapitalize="characters"
                          className="h-8 w-14 px-1 text-xs uppercase"
                          placeholder="ABR"
                          value={draft.familyAbbreviation}
                          disabled={savingKey === draft.key}
                          onChange={(event) =>
                            updateGroup(draft.key, { familyAbbreviation: event.target.value.toUpperCase() })
                          }
                        />
                      ) : (
                        draft.familyAbbreviation
                      )}
                    </td>
                    {allFactoryProcesses.map((process) => (
                      <td key={process.id} className="border-b border-l p-2">
                        {renderCapacityCell(draft, process, editable)}
                      </td>
                    ))}
                    {canManage ? (
                      <td className="border-b border-l px-2 py-2 text-right">
                        <div className="flex min-w-32 flex-col items-end gap-1">
                          {draft.error ? (
                            <p role="alert" className="max-w-48 text-left text-xs text-destructive">
                              {draft.error}
                            </p>
                          ) : null}
                          {editable ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={savingKey !== null || unmappedProcesses.length > 0}
                                onClick={() => void saveGroup(draft)}
                              >
                                {savingKey === draft.key ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                ) : (
                                  <Save className="h-4 w-4" aria-hidden />
                                )}
                                Salvar
                              </Button>
                              {draft.id === null ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={savingKey !== null}
                                  onClick={() => removeNewGroup(draft.key)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                  Remover linha
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={savingKey !== null}
                                  onClick={() => cancelEdit(draft)}
                                >
                                  Cancelar
                                </Button>
                              )}
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={savingKey !== null}
                                onClick={() => startEdit(draft.key)}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                                Editar
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                disabled={savingKey !== null}
                                onClick={() => void deleteGroup(draft)}
                                aria-label={`Excluir o grupo ${draft.groupType ?? draft.familyAbbreviation}`}
                              >
                                {savingKey === draft.key ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                )}
                                Excluir
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {allFactoryProcesses.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 4 : 3}
                    className="px-3 py-5 text-center text-muted-foreground"
                  >
                    Cadastre processos e associe-os a uma fábrica para configurar capacidades.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
