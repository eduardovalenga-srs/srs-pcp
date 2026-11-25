"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  createRecruitmentApprovedRoleAction,
  createRecruitmentCustomerAction,
  deleteRecruitmentApprovedRoleAction,
  setRecruitmentApprovedRoleActiveAction,
  updateRecruitmentApprovedRoleAction,
} from "@/lib/actions/recruitment.actions";
import type { RecruitmentApprovedRoleManagementData } from "@/lib/types/recruitment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RecruitmentApprovedRolesManager({
  data,
  canManage,
}: {
  data: RecruitmentApprovedRoleManagementData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(
    data.clients.find((client) => client.active)?.id ?? data.clients[0]?.id ?? "",
  );
  const [roleName, setRoleName] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState("");
  const [error, setError] = useState("");

  function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createRecruitmentCustomerAction({ name: newClientName });
      if (!result.success || !result.id) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setClientId(result.id);
      setNewClientName("");
      setShowNewClient(false);
      toast.success(result.message);
      router.refresh();
    });
  }

  function createRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createRecruitmentApprovedRoleAction({ clientId, name: roleName });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setRoleName("");
      toast.success(result.message);
      router.refresh();
    });
  }

  function toggleRole(roleId: string, active: boolean) {
    setError("");
    startTransition(async () => {
      const result = await setRecruitmentApprovedRoleActiveAction({ id: roleId, active });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  function beginEditRole(roleId: string, name: string) {
    setError("");
    setEditingRoleId(roleId);
    setEditingRoleName(name);
  }

  function cancelEditRole() {
    setEditingRoleId(null);
    setEditingRoleName("");
  }

  function saveRoleName(event: React.FormEvent<HTMLFormElement>, roleId: string) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await updateRecruitmentApprovedRoleAction({
        id: roleId,
        name: editingRoleName,
      });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      cancelEditRole();
      toast.success(result.message);
      router.refresh();
    });
  }

  function deleteRole(roleId: string, name: string) {
    if (
      pending ||
      !window.confirm(
        `Excluir o cargo aprovado “${name}”? Cargos usados por vagas não podem ser excluídos; nesse caso, inative-o para preservar o histórico.`,
      )
    ) {
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await deleteRecruitmentApprovedRoleAction({ id: roleId });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const activeClients = new Set(data.clients.filter((client) => client.active).map((client) => client.id));
  const selectedClientActive = activeClients.has(clientId);
  const visibleRoles = data.roles.filter((role) => role.client_id === clientId);

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <div>
          <h2 className="font-semibold">
            {canManage ? "Cadastrar cargo aprovado" : "Cargos aprovados do cliente"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage
              ? "O cargo ficará disponível na abertura de vagas para o cliente selecionado."
              : "Você está vendo somente os cargos do cliente vinculado à sua conta."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="approvedRoleClient">Cliente</Label>
            <select
              id="approvedRoleClient"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className={selectClass}
              disabled={pending || data.clients.length === 0}
            >
              <option value="">Selecione o cliente</option>
              {data.clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError("");
                setShowNewClient((current) => !current);
              }}
              disabled={pending}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Novo cliente
            </Button>
          ) : null}
        </div>

        {canManage && showNewClient ? (
          <form onSubmit={createClient} className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="newRecruitmentClient">Nome do novo cliente</Label>
              <Input
                id="newRecruitmentClient"
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                maxLength={120}
                required
                disabled={pending}
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Cadastrar cliente
            </Button>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              O cliente será criado na raiz da árvore. Cadastre local, turno e área em Alocações antes de abrir uma vaga.
            </p>
          </form>
        ) : null}

        {canManage ? (
          <form onSubmit={createRole} className="grid gap-4 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="approvedRoleName">Cargo aprovado</Label>
              <Input
                id="approvedRoleName"
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
                maxLength={120}
                placeholder="Ex.: Soldador"
                required
                disabled={pending || !clientId || !selectedClientActive}
              />
            </div>
            <Button type="submit" disabled={pending || !clientId || !selectedClientActive}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              Salvar cargo
            </Button>
          </form>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Cargos cadastrados</h2>
          <p className="text-sm text-muted-foreground">
            Cargos inativos permanecem no histórico, mas não aparecem na abertura de vagas.
          </p>
        </div>
        {visibleRoles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum cargo aprovado cadastrado para este cliente.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {visibleRoles.map((role) => {
              const clientActive = activeClients.has(role.client_id);
              return (
                <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-4">
                  <div>
                    {editingRoleId === role.id ? (
                      <form
                        onSubmit={(event) => saveRoleName(event, role.id)}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Input
                          value={editingRoleName}
                          onChange={(event) => setEditingRoleName(event.target.value)}
                          maxLength={120}
                          required
                          autoFocus
                          aria-label={`Nome do cargo aprovado para ${role.client_name}`}
                          disabled={pending}
                          className="h-8 w-56"
                        />
                        <Button type="submit" size="sm" disabled={pending}>
                          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                          Salvar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={cancelEditRole}
                          disabled={pending}
                        >
                          <X className="h-4 w-4" aria-hidden />
                          Cancelar
                        </Button>
                      </form>
                    ) : (
                      <p className="font-medium">{role.name}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {role.client_name}{!clientActive ? " · cliente inativo" : ""}
                    </p>
                  </div>
                  {editingRoleId === role.id ? null : (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => beginEditRole(role.id, role.name)}
                        disabled={pending}
                        aria-label={`Editar cargo ${role.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteRole(role.id, role.name)}
                        disabled={pending}
                        aria-label={`Excluir cargo ${role.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Excluir
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={role.active ? "outline" : "secondary"}
                        onClick={() => toggleRole(role.id, !role.active)}
                        disabled={pending || (!clientActive && !role.active)}
                      >
                        {role.active ? "Inativar" : "Reativar"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
