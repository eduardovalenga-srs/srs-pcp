"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  FolderTree,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Trash2,
  UserRoundPlus,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";

import {
  assignEmployeeToPositionAction,
  createEmployeeAllocationNodeAction,
  setEmployeeAllocationNodeActiveAction,
  deleteEmployeeAllocationNodeAction,
  updateEmployeeAllocationNodeAction,
} from "@/lib/actions/employee-allocation.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ALLOCATION_CHILD_KIND,
  ALLOCATION_KIND_LABEL,
  type AllocationEmployee,
  type EmployeeAllocationNode,
} from "@/lib/types/employee-allocation";

type TreeDialog =
  | { kind: "create"; parent: EmployeeAllocationNode }
  | { kind: "create-client" }
  | { kind: "edit"; node: EmployeeAllocationNode }
  | { kind: "assign"; position: EmployeeAllocationNode };

type AllocationSummary = { positions: number; occupied: number };

const EMPTY_SUMMARY: AllocationSummary = { positions: 0, occupied: 0 };

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

export function EmployeeAllocationTree({
  nodes,
  employees,
  canManage,
}: {
  nodes: EmployeeAllocationNode[];
  employees: AllocationEmployee[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(() => new Set(nodes.map((node) => node.id)));
  const [dialog, setDialog] = useState<TreeDialog | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");

  const childrenByParent = useMemo(() => {
    const map = new Map<string, EmployeeAllocationNode[]>();
    for (const node of nodes) {
      if (!node.parent_id) continue;
      const siblings = map.get(node.parent_id) ?? [];
      siblings.push(node);
      map.set(node.parent_id, siblings);
    }
    return map;
  }, [nodes]);

  const employeeByPosition = useMemo(
    () => new Map(employees.filter((employee) => employee.allocation_position_id)
      .map((employee) => [employee.allocation_position_id!, employee])),
    [employees],
  );

  const summaryByNode = useMemo(() => {
    const summaries = new Map<string, AllocationSummary>();
    const summarize = (node: EmployeeAllocationNode): AllocationSummary => {
      if (node.node_type === "POSITION") {
        const activeEmployee = employeeByPosition.get(node.id);
        const summary = {
          positions: node.active ? 1 : 0,
          occupied: node.active && activeEmployee?.status === "ATIVO" ? 1 : 0,
        };
        summaries.set(node.id, summary);
        return summary;
      }
      const summary = (childrenByParent.get(node.id) ?? []).reduce<AllocationSummary>(
        (total, child) => {
          const childSummary = summarize(child);
          if (!node.active) return total;
          return {
            positions: total.positions + childSummary.positions,
            occupied: total.occupied + childSummary.occupied,
          };
        },
        EMPTY_SUMMARY,
      );
      summaries.set(node.id, summary);
      return summary;
    };

    for (const root of nodes.filter((node) => node.node_type === "CLIENT" && !node.parent_id)) {
      summarize(root);
    }
    return summaries;
  }, [childrenByParent, employeeByPosition, nodes]);

  const openCreate = (parent: EmployeeAllocationNode) => {
    setFormError("");
    setDialog({ kind: "create", parent });
  };

  const openCreateClient = () => {
    setFormError("");
    setDialog({ kind: "create-client" });
  };

  const openEdit = (node: EmployeeAllocationNode) => {
    setFormError("");
    setDialog({ kind: "edit", node });
  };

  const openAssign = (position: EmployeeAllocationNode, employeeId = "") => {
    setSelectedEmployeeId(employeeId);
    setFormError("");
    setDialog({ kind: "assign", position });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function submitTreeEdit(formData: FormData) {
    if (!dialog || dialog.kind === "assign" || pending) return;
    setPending(true);
    setFormError("");
    try {
      const result = dialog.kind === "create" || dialog.kind === "create-client"
        ? await createEmployeeAllocationNodeAction({
            parentId: dialog.kind === "create" ? dialog.parent.id : null,
            name: String(formData.get("name") ?? ""),
            locationLeader: String(formData.get("locationLeader") ?? ""),
            locationSupervisor: String(formData.get("locationSupervisor") ?? ""),
          })
        : await updateEmployeeAllocationNodeAction({
            id: dialog.node.id,
            name: String(formData.get("name") ?? ""),
            locationLeader: String(formData.get("locationLeader") ?? ""),
            locationSupervisor: String(formData.get("locationSupervisor") ?? ""),
          });
      if (!result.success) {
        setFormError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setDialog(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar.";
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(node: EmployeeAllocationNode) {
    if (pending || node.node_type === "COMPANY") return;
    const nextActive = !node.active;
    if (!nextActive && !window.confirm(`Inativar "${node.name}"? Isso também impedirá novas alocações nos níveis abaixo.`)) {
      return;
    }
    setPending(true);
    try {
      const result = await setEmployeeAllocationNodeActiveAction({ id: node.id, active: nextActive });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    } finally {
      setPending(false);
    }
  }

  async function deleteNode(node: EmployeeAllocationNode) {
    if (pending || node.node_type === "COMPANY") return;
    const countDescendants = (nodeId: string): number =>
      (childrenByParent.get(nodeId) ?? []).reduce(
        (count, child) => count + 1 + countDescendants(child.id),
        0,
      );
    const descendants = countDescendants(node.id);
    const impact = descendants > 0
      ? ` A exclusão também removerá permanentemente ${descendants} item(ns) abaixo deste nível.`
      : "";
    if (
      !window.confirm(
        `Excluir "${node.name}" permanentemente? Funcionários alocados impedem a exclusão.${impact}`,
      )
    ) {
      return;
    }

    setPending(true);
    try {
      const result = await deleteEmployeeAllocationNodeAction({ id: node.id });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir o item.");
    } finally {
      setPending(false);
    }
  }

  async function submitAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "assign" || pending) return;
    if (!selectedEmployeeId) {
      setFormError("Selecione um funcionário.");
      return;
    }
    const employee = employees.find((item) => item.id === selectedEmployeeId);
    if (!employee) {
      setFormError("Funcionário não encontrado.");
      return;
    }
    if (
      employee.allocation_position_id &&
      employee.allocation_position_id !== dialog.position.id &&
      !window.confirm(`${employee.name} será transferido. A posição atual ficará vaga. Continuar?`)
    ) {
      return;
    }
    setPending(true);
    setFormError("");
    try {
      const result = await assignEmployeeToPositionAction({
        employeeId: employee.id,
        positionId: dialog.position.id,
      });
      if (!result.success) {
        setFormError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setDialog(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível alocar o funcionário.";
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function unassign(employee: AllocationEmployee, position: EmployeeAllocationNode) {
    if (pending || !window.confirm(`Desalocar ${employee.name}? A posição "${position.name}" ficará vaga.`)) {
      return;
    }
    setPending(true);
    try {
      const result = await assignEmployeeToPositionAction({
        employeeId: employee.id,
        positionId: null,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desalocar o funcionário.");
    } finally {
      setPending(false);
    }
  }

  const renderNode = (node: EmployeeAllocationNode, inheritedActive = true): React.ReactNode => {
    const children = childrenByParent.get(node.id) ?? [];
    const hasChildren = children.length > 0;
    const isOpen = expanded.has(node.id);
    const effectiveActive = inheritedActive && node.active;
    const summary = summaryByNode.get(node.id) ?? EMPTY_SUMMARY;
    const occupant = employeeByPosition.get(node.id);
    const childKind = ALLOCATION_CHILD_KIND[node.node_type];
    const isPosition = node.node_type === "POSITION";
    const sameNamePositions = isPosition && node.parent_id
      ? (childrenByParent.get(node.parent_id) ?? []).filter(
          (sibling) =>
            sibling.node_type === "POSITION" &&
            sibling.name.trim().toLocaleLowerCase("pt-BR") === node.name.trim().toLocaleLowerCase("pt-BR"),
        )
      : [];
    const duplicatePositionNumber = sameNamePositions.length > 1
      ? sameNamePositions.findIndex((sibling) => sibling.id === node.id) + 1
      : null;

    return (
      <li key={node.id} className="min-w-0">
        <div
          className={classNames(
            "flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-card px-2 py-1.5 sm:px-3",
            !effectiveActive && "border-dashed bg-muted/40 text-muted-foreground",
          )}
        >
          <button
            type="button"
            className={classNames(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted",
              !hasChildren && "invisible",
            )}
            onClick={() => toggleExpanded(node.id)}
            aria-label={`${isOpen ? "Recolher" : "Expandir"} ${node.name}`}
            aria-expanded={isOpen}
            disabled={!hasChildren}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {isPosition ? (
            occupant ? <CircleUserRound className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden /> :
              <UserRoundPlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{node.name}</span>
            {duplicatePositionNumber ? (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Vaga {duplicatePositionNumber}
              </span>
            ) : null}
            <span className="ml-2 text-xs text-muted-foreground">
              {ALLOCATION_KIND_LABEL[node.node_type]}
            </span>
            {node.node_type === "LOCATION" &&
            (node.location_leader || node.location_supervisor) ? (
              <span className="block text-xs text-muted-foreground">
                {node.location_leader ? `Líder: ${node.location_leader}` : null}
                {node.location_leader && node.location_supervisor ? " · " : null}
                {node.location_supervisor ? `Encarregado: ${node.location_supervisor}` : null}
              </span>
            ) : null}
            {isPosition && occupant ? (
              <span className="ml-2 text-sm text-muted-foreground">
                — {occupant.name} ({occupant.registration})
                {occupant.status !== "ATIVO" ? " · inativo" : ""}
              </span>
            ) : null}
          </span>
          {!isPosition ? (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {summary.occupied}/{summary.positions} ocupadas
            </span>
          ) : (
            <span
              className={classNames(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                occupant ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" :
                  "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
              )}
            >
              {occupant ? "Ocupada" : "Vaga"}
            </span>
          )}
          {!effectiveActive ? (
            <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs">Inativa</span>
          ) : null}
          {canManage && effectiveActive && childKind ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => openCreate(node)}
              disabled={pending}
              aria-label={`Adicionar ${ALLOCATION_KIND_LABEL[childKind]} abaixo de ${node.name}`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Adicionar</span>
            </Button>
          ) : null}
          {canManage && node.node_type !== "COMPANY" ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => openEdit(node)}
                disabled={pending}
                aria-label={`Editar ${node.name}`}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => void toggleActive(node)}
                disabled={pending}
                aria-label={`${node.active ? "Inativar" : "Reativar"} ${node.name}`}
              >
                {node.active ? <Minus className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                <span className="hidden sm:inline">{node.active ? "Inativar" : "Reativar"}</span>
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => void deleteNode(node)}
                disabled={pending}
                aria-label={`Excluir ${node.name}`}
                title="Excluir este nível e toda a estrutura abaixo"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </>
          ) : null}
          {canManage && isPosition && effectiveActive ? (
            occupant ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => openAssign(node, occupant.id)}
                  disabled={pending || occupant.status !== "ATIVO"}
                >
                  Transferir
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => void unassign(occupant, node)}
                  disabled={pending || occupant.status !== "ATIVO"}
                  aria-label={`Desalocar ${occupant.name}`}
                >
                  <UserRoundX className="h-4 w-4" aria-hidden />
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => openAssign(node)}
                disabled={pending}
              >
                Alocar funcionário
              </Button>
            )
          ) : null}
        </div>
        {hasChildren && isOpen ? (
          <ul className="ml-4 mt-1 space-y-1 border-l pl-3 sm:ml-6 sm:pl-4">
            {children.map((child) => renderNode(child, effectiveActive))}
          </ul>
        ) : null}
      </li>
    );
  };

  const roots = nodes.filter((node) => node.node_type === "CLIENT" && !node.parent_id);
  const totals = roots.reduce<AllocationSummary>((total, root) => {
    const summary = summaryByNode.get(root.id) ?? EMPTY_SUMMARY;
    return {
      positions: total.positions + summary.positions,
      occupied: total.occupied + summary.occupied,
    };
  }, EMPTY_SUMMARY);
  const assignableEmployees = dialog?.kind === "assign"
    ? employees.filter((employee) =>
        (employee.status === "ATIVO" || employee.id === selectedEmployeeId),
      )
    : [];
  const dialogNodeType = dialog?.kind === "create-client"
    ? "CLIENT"
    : dialog?.kind === "create"
      ? ALLOCATION_CHILD_KIND[dialog.parent.node_type]
    : dialog?.kind === "edit"
      ? dialog.node.node_type
      : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
        <div>
          <p className="font-medium">Posições ocupadas: {totals.occupied} de {totals.positions}</p>
          <p className="text-sm text-muted-foreground">
            Atribua cada funcionário a uma posição individual. Uma transferência libera automaticamente a posição anterior.
          </p>
        </div>
        <div className="flex gap-2">
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={openCreateClient} disabled={pending}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Adicionar cliente
            </Button>
          ) : null}
          {nodes.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExpanded((current) =>
                current.size === nodes.length ? new Set() : new Set(nodes.map((node) => node.id)),
              )}
            >
              {expanded.size === nodes.length ? "Recolher árvore" : "Expandir árvore"}
            </Button>
          ) : null}
        </div>
      </div>

      {roots.length > 0 ? (
        <ul className="space-y-2">
          {roots.map((root) => renderNode(root))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum cliente cadastrado para iniciar a árvore.
        </div>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setDialog(null);
            setFormError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {dialog?.kind === "create" || dialog?.kind === "create-client" || dialog?.kind === "edit" ? (
            <form action={submitTreeEdit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>
                  {dialog.kind === "create-client"
                    ? "Adicionar cliente"
                    : dialog.kind === "create"
                      ? `Adicionar ${ALLOCATION_KIND_LABEL[ALLOCATION_CHILD_KIND[dialog.parent.node_type]!].toLowerCase()}`
                    : `Editar ${ALLOCATION_KIND_LABEL[dialog.node.node_type].toLowerCase()}`}
                </DialogTitle>
                <DialogDescription>
                  {dialog.kind === "create-client"
                    ? "Novo cliente na raiz da árvore de alocações."
                    : dialog.kind === "create"
                      ? `Novo item abaixo de ${dialog.parent.name}.`
                    : "A alteração também atualiza os dados de alocação dos funcionários vinculados."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="allocation-node-name">Nome</Label>
                <Input
                  id="allocation-node-name"
                  name="name"
                  defaultValue={dialog.kind === "edit" ? dialog.node.name : ""}
                  maxLength={120}
                  required
                  autoFocus
                />
              </div>
              {dialogNodeType === "LOCATION" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="allocation-location-leader">Líder do local de trabalho</Label>
                    <Input
                      id="allocation-location-leader"
                      name="locationLeader"
                      defaultValue={dialog.kind === "edit" ? dialog.node.location_leader ?? "" : ""}
                      maxLength={150}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="allocation-location-supervisor">Encarregado do local de trabalho</Label>
                    <Input
                      id="allocation-location-supervisor"
                      name="locationSupervisor"
                      defaultValue={dialog.kind === "edit" ? dialog.node.location_supervisor ?? "" : ""}
                      maxLength={150}
                    />
                  </div>
                </div>
              ) : null}
              {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          ) : dialog?.kind === "assign" ? (
            <form onSubmit={(event) => void submitAssignment(event)} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{employeeByPosition.has(dialog.position.id) ? "Transferir funcionário" : "Alocar funcionário"}</DialogTitle>
                <DialogDescription>
                  Posição: {dialog.position.name}. São exibidos funcionários ativos de todas as empresas.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="allocation-employee">Funcionário</Label>
                <select
                  id="allocation-employee"
                  value={selectedEmployeeId}
                  onChange={(event) => setSelectedEmployeeId(event.target.value)}
                  disabled={pending}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  required
                >
                  <option value="">Selecione um funcionário</option>
                  {assignableEmployees
                    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} — matrícula {employee.registration}
                        {employee.allocation_position_id && employee.allocation_position_id !== dialog.position.id
                          ? " (já alocado; será transferido)"
                          : ""}
                      </option>
                    ))}
                </select>
              </div>
              {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
              <DialogFooter>
                <Button type="submit" disabled={pending || !selectedEmployeeId}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Confirmar alocação
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
