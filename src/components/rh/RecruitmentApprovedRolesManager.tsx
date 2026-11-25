"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import {
  createRecruitmentApprovedRoleAction,
  createRecruitmentCustomerAction,
  setRecruitmentApprovedRoleActiveAction,
} from "@/lib/actions/recruitment.actions";
import type { RecruitmentApprovedRoleManagementData } from "@/lib/types/recruitment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RecruitmentApprovedRolesManager({
  data,
}: {
  data: RecruitmentApprovedRoleManagementData;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? "");
  const [roleName, setRoleName] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
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

  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const activeClients = new Set(data.clients.map((client) => client.id));

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <div>
          <h2 className="font-semibold">Cadastrar cargo aprovado</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O cargo ficará disponível na abertura de vagas para o cliente selecionado.
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
        </div>

        {showNewClient ? (
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
              disabled={pending || !clientId}
            />
          </div>
          <Button type="submit" disabled={pending || !clientId}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salvar cargo
          </Button>
        </form>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Cargos cadastrados</h2>
          <p className="text-sm text-muted-foreground">
            Cargos inativos permanecem no histórico, mas não aparecem na abertura de vagas.
          </p>
        </div>
        {data.roles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum cargo aprovado cadastrado.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {data.roles.map((role) => {
              const clientActive = activeClients.has(role.client_id);
              return (
                <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-4">
                  <div>
                    <p className="font-medium">{role.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {role.client_name}{!clientActive ? " · cliente inativo" : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={role.active ? "outline" : "secondary"}
                    onClick={() => toggleRole(role.id, !role.active)}
                    disabled={pending || (!clientActive && !role.active)}
                  >
                    {role.active ? "Inativar" : "Reativar"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
