"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Pencil, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import {
  createProcessAction,
  reorderProcessesAction,
  updateCatalogProcessAction,
} from "@/lib/actions/processes.actions";
import type { ProcessDefinition } from "@/lib/types/production";
import {
  createProcessSchema,
  updateProcessSchema,
  type CreateProcessInput,
  type UpdateProcessInput,
} from "@/lib/validators/process.schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProcessCatalogProps {
  processes: ProcessDefinition[];
  canManage: boolean;
}

/** Catálogo de processos (o Admin monta o fluxo fabril da fábrica). */
export function ProcessCatalog({ processes, canManage }: ProcessCatalogProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessDefinition | null>(null);
  const [busy, setBusy] = useState(false);

  const createForm = useForm<CreateProcessInput>({
    resolver: zodResolver(createProcessSchema),
    defaultValues: { code: "", name: "", location: "", durationDays: 1 },
  });

  // Lista local exibida (estado otimista do arrastar-e-soltar). Quando o
  // servidor devolve o catálogo revalidado (nova referência de `processes`),
  // ressincroniza durante o render — padrão "adjusting state when props
  // change" do React (evita o setState dentro de effect).
  const [items, setItems] = useState(processes);
  const [prevProcesses, setPrevProcesses] = useState(processes);
  if (prevProcesses !== processes) {
    setPrevProcesses(processes);
    setItems(processes);
  }
  const [reordering, setReordering] = useState(false);

  const editForm = useForm<UpdateProcessInput>({
    resolver: zodResolver(updateProcessSchema),
  });
  const editActive = useWatch({ control: editForm.control, name: "active" });

  const onCreate = createForm.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const result = await createProcessAction(values);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setCreateOpen(false);
      createForm.reset({ code: "", name: "", location: "", durationDays: 1 });
      router.refresh();
    } finally {
      setBusy(false);
    }
  });

  const onEdit = editForm.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const result = await updateCatalogProcessAction(values);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  });

  const toggleActive = async (process: ProcessDefinition) => {
    if (!canManage) return;
    const result = await updateCatalogProcessAction({
      id: process.id,
      name: process.name,
      active: !process.active,
      location: process.location,
      durationDays: process.durationDays,
    });
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    router.refresh();
  };

  const openEdit = (process: ProcessDefinition) => {
    editForm.reset({
      id: process.id,
      name: process.name,
      active: process.active,
      location: process.location ?? "",
      durationDays: process.durationDays,
    });
    setEditing(process);
  };

  const sensors = useSensors(
    // Distância mínima para o arraste: um clique simples não move a linha
    // (os botões de editar/ativar continuam clicáveis).
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Teclado: espaço captura, setas movem, espaço solta, esc cancela.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: UniqueIdentifier): string =>
    items.find((process) => process.id === id)?.name ?? "processo";
  const positionOf = (id: UniqueIdentifier): number =>
    items.findIndex((process) => process.id === id) + 1;

  // Instruções em pt-BR exibidas ocultas para leitores de tela.
  const screenReaderInstructions = {
    draggable:
      "Para reordenar a cadeia de processos: pressione espaço para capturar a linha, " +
      "use as setas para mover, espaço para soltar e Esc para cancelar.",
  };

  // Anúncios em pt-BR para leitores de tela durante a reordenação.
  const announcements: Announcements = {
    onDragStart: ({ active }: DragStartEvent) =>
      `${nameOf(active.id)} capturado, posição ${positionOf(active.id)} de ${items.length}. ` +
      "Use as setas para mover, espaço para soltar e Esc para cancelar.",
    onDragOver: ({ active, over }: DragOverEvent) =>
      over
        ? `${nameOf(active.id)} sobre a posição ${positionOf(over.id)} (${nameOf(over.id)}).`
        : `${nameOf(active.id)} sem destino.`,
    onDragEnd: ({ active, over }: DragEndEvent) =>
      over
        ? `${nameOf(active.id)} movido para a posição ${positionOf(over.id)}.`
        : `${nameOf(active.id)} devolvido à posição original.`,
    onDragCancel: ({ active }: DragCancelEvent) =>
      `Reordenação cancelada; ${nameOf(active.id)} permanece na posição ${positionOf(active.id)}.`,
  };

  /**
   * Solta a linha: renumera 1..N localmente (otimista), persiste a lista
   * completa em UMA transação via RPC e, em erro, restaura a ordem anterior.
   */
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || reordering) return;
    const oldIndex = items.findIndex((process) => process.id === active.id);
    const newIndex = items.findIndex((process) => process.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = items;
    const moved = arrayMove(items, oldIndex, newIndex).map((process, index) => ({
      ...process,
      displayOrder: index + 1,
    }));
    setItems(moved);
    setReordering(true);
    try {
      const result = await reorderProcessesAction(moved.map((process) => process.id));
      if (!result.success) {
        setItems(previous);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      // Propaga a nova ordem às telas dependentes (colunas, janelas previstas).
      router.refresh();
    } catch (error) {
      setItems(previous);
      toast.error(
        error instanceof Error ? error.message : "Não foi possível reordenar os processos.",
      );
    } finally {
      setReordering(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)} disabled={!canManage} size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          Novo processo
        </Button>
      </div>

      {processes.length === 0 ? (
        <EmptyState
          title="Nenhum processo cadastrado"
          description="Crie as etapas do seu fluxo fabril para que elas apareçam como colunas na gestão de entregas."
        />
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToParentElement]}
            accessibility={{ announcements, screenReaderInstructions }}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            <div className="overflow-x-auto rounded border bg-card">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Catálogo de processos do fluxo fabril, da primeira à última etapa da cadeia
                </caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    {canManage ? (
                      <th scope="col" className="px-2 py-2">
                        <span className="sr-only">Reordenar</span>
                      </th>
                    ) : null}
                    <th scope="col" className="px-3 py-2 font-semibold">Ordem</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Código</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Nome</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Local</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Duração</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <SortableContext
                  items={items.map((process) => process.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody>
                    {items.map((process) => (
                      <SortableProcessRow
                        key={process.id}
                        process={process}
                        canManage={canManage}
                        disabled={!canManage || reordering}
                        onEdit={openEdit}
                        onToggle={(target) => void toggleActive(target)}
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </div>
          </DndContext>

          {canManage ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Arraste as linhas pela alça <GripVertical className="inline h-3 w-3" aria-hidden />{" "}
              para reordenar a cadeia: a ordem define as colunas da gestão de entregas e as datas
              previstas de execução.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Apenas administradores alteram o catálogo de processos.
            </p>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo processo</DialogTitle>
            <DialogDescription>
              O código vira coluna na tela de gestão de entregas e não pode ser alterado depois.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onCreate} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="processo-novo-codigo">Código</Label>
              <Input
                id="processo-novo-codigo"
                placeholder="EX: SERTELA"
                autoCapitalize="characters"
                {...createForm.register("code")}
                aria-invalid={!!createForm.formState.errors.code}
                aria-describedby="processo-novo-codigo-erro"
              />
              <p id="processo-novo-codigo-erro" role="alert" className="text-xs text-status-blocked">
                {createForm.formState.errors.code?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-novo-nome">Nome</Label>
              <Input
                id="processo-novo-nome"
                placeholder="EX: Sertelagem"
                {...createForm.register("name")}
                aria-invalid={!!createForm.formState.errors.name}
              />
              <p role="alert" className="text-xs text-status-blocked">
                {createForm.formState.errors.name?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-novo-local">Local</Label>
              <Input
                id="processo-novo-local"
                placeholder="EX: Fábrica 1"
                {...createForm.register("location")}
                aria-invalid={!!createForm.formState.errors.location}
              />
              <p role="alert" className="text-xs text-status-blocked">
                {createForm.formState.errors.location?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-novo-duracao">Duração (dias úteis)</Label>
              <Input
                id="processo-novo-duracao"
                inputMode="numeric"
                placeholder="1"
                {...createForm.register("durationDays")}
                aria-invalid={!!createForm.formState.errors.durationDays}
                aria-describedby="processo-novo-duracao-ajuda"
              />
              <p id="processo-novo-duracao-ajuda" className="text-xs text-muted-foreground">
                Dias úteis (seg–sex) que o processo leva para ser concluído — alimenta as datas
                previstas na gestão de entregas: a expedição acontece no dia útil anterior à
                entrega e a contagem segue para trás, sem agendar fim de semana.
              </p>
              <p role="alert" className="text-xs text-status-blocked">
                {createForm.formState.errors.durationDays?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-novo-ordem">Ordem de exibição</Label>
              <Input
                id="processo-novo-ordem"
                inputMode="numeric"
                disabled
                value={Math.max(...processes.map((p) => p.displayOrder), 0) + 1}
                readOnly
                aria-describedby="processo-novo-ordem-ajuda"
              />
              <p id="processo-novo-ordem-ajuda" className="text-xs text-muted-foreground">
                Automática: o processo entra ao final da cadeia. Para mudar a posição, arraste a
                linha na lista.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Criar processo
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar processo</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.code} — altere nome, local, duração e situação.` : ""}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onEdit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="processo-editar-nome">Nome</Label>
              <Input
                id="processo-editar-nome"
                {...editForm.register("name")}
                aria-invalid={!!editForm.formState.errors.name}
              />
              <p role="alert" className="text-xs text-status-blocked">
                {editForm.formState.errors.name?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-editar-local">Local</Label>
              <Input
                id="processo-editar-local"
                placeholder="EX: Fábrica 1"
                {...editForm.register("location")}
                aria-invalid={!!editForm.formState.errors.location}
              />
              <p role="alert" className="text-xs text-status-blocked">
                {editForm.formState.errors.location?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-editar-duracao">Duração (dias úteis)</Label>
              <Input
                id="processo-editar-duracao"
                inputMode="numeric"
                placeholder="1"
                {...editForm.register("durationDays")}
                aria-invalid={!!editForm.formState.errors.durationDays}
                aria-describedby="processo-editar-duracao-ajuda"
              />
              <p id="processo-editar-duracao-ajuda" className="text-xs text-muted-foreground">
                Dias úteis (seg–sex) que o processo leva para ser concluído — alimenta as datas
                previstas na gestão de entregas: a expedição acontece no dia útil anterior à
                entrega e a contagem segue para trás, sem agendar fim de semana.
              </p>
              <p role="alert" className="text-xs text-status-blocked">
                {editForm.formState.errors.durationDays?.message}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="processo-editar-ordem">Ordem de exibição</Label>
              <Input id="processo-editar-ordem" value={editing?.displayOrder ?? ""} readOnly disabled />
              <p className="text-xs text-muted-foreground">
                Para mudar a posição na cadeia, arraste a linha na lista.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="processo-editar-ativo"
                checked={editActive === true}
                onCheckedChange={(checked) => editForm.setValue("active", checked === true)}
              />
              <Label htmlFor="processo-editar-ativo">Processo ativo (aparece na gestão de entregas)</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface SortableProcessRowProps {
  process: ProcessDefinition;
  canManage: boolean;
  disabled: boolean;
  onEdit: (process: ProcessDefinition) => void;
  onToggle: (process: ProcessDefinition) => void;
}

/**
 * Linha da cadeia com arrastar-e-soltar (dnd-kit). A alça só aparece para
 * quem pode gerenciar; com teclado, espaço captura e as setas movem.
 */
function SortableProcessRow({
  process,
  canManage,
  disabled,
  onEdit,
  onToggle,
}: SortableProcessRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: process.id,
    disabled,
  });

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        isDragging
          ? "relative z-10 border-b bg-accent/60 shadow-sm last:border-0"
          : "border-b last:border-0 hover:bg-muted/30"
      }
    >
      {canManage ? (
        <td className="px-2 py-2 align-middle">
          <button
            type="button"
            aria-label={`Reordenar ${process.name}`}
            title="Arraste para reordenar a cadeia"
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        </td>
      ) : null}
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{process.displayOrder}</td>
      <td className="px-3 py-2 font-medium">{process.code}</td>
      <td className="px-3 py-2">{process.name}</td>
      <td className="px-3 py-2 text-muted-foreground">{process.location || "—"}</td>
      <td className="px-3 py-2 tabular-nums">
        {process.durationDays} dia{process.durationDays > 1 ? "s" : ""}
      </td>
      <td className="px-3 py-2">
        <Badge variant={process.active ? "success" : "muted"}>
          {process.active ? "Ativo" : "Inativo"}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Editar ${process.name}`}
            title="Editar"
            disabled={!canManage}
            onClick={() => onEdit(process)}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${process.active ? "Desativar" : "Ativar"} ${process.name}`}
            title={process.active ? "Desativar" : "Ativar"}
            disabled={!canManage}
            onClick={() => onToggle(process)}
          >
            {process.active ? (
              <ToggleRight className="h-4 w-4" aria-hidden />
            ) : (
              <ToggleLeft className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}
