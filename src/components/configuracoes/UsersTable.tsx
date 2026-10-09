"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import {
  changeUserRoleAction,
  generateRecoveryLinkAction,
  setUserActiveAction,
} from "@/lib/actions/users.actions";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants/orders";
import type { ManagedUser } from "@/lib/services/users.service";
import { formatDateTime } from "@/lib/utils/dates";
import { CreateUserDialog } from "@/components/configuracoes/CreateUserDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface UsersTableProps {
  users: ManagedUser[];
  currentUser: { id: string; email: string };
  canManageUsers: boolean;
}

type ToggleTarget = { user: ManagedUser; active: boolean } | null;

/** Tabela de usuários: perfil, status, acesso e ações de administração. */
export function UsersTable({ users, currentUser, canManageUsers }: UsersTableProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<ToggleTarget>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<ManagedUser | null>(null);
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const changeRole = async (profileId: string, role: Role) => {
    setPendingId(profileId);
    try {
      const result = await changeUserRoleAction(profileId, role);
      if (!result.success) {
        toast.error(result.message);
        router.refresh(); // reverte o Select para o valor real
        return;
      }
      toast.success(result.message);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const confirmToggle = async () => {
    if (!toggleTarget) return;
    setPendingId(toggleTarget.user.id);
    try {
      const result = await setUserActiveAction(toggleTarget.user.id, toggleTarget.active);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setToggleTarget(null);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const openRecovery = async (user: ManagedUser) => {
    setRecoveryTarget(user);
    setRecoveryLink(null);
    setRecoveryBusy(true);
    try {
      const result = await generateRecoveryLinkAction(user.id);
      if (!result.success || !result.recoveryLink) {
        toast.error(result.message);
        setRecoveryTarget(null);
        return;
      }
      setRecoveryLink(result.recoveryLink);
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyLink = async () => {
    if (!recoveryLink) return;
    try {
      await navigator.clipboard.writeText(recoveryLink);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  };

  if (users.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Usuários</h2>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <section aria-label="Usuários" className="overflow-x-auto rounded border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Usuários</h2>
          <p className="text-xs text-muted-foreground">
            O perfil define o que cada pessoa pode ver e editar. Contas desativadas não entram e
            perdem a sessão na hora.
          </p>
        </div>
        {canManageUsers ? <CreateUserDialog /> : null}
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Usuários cadastrados, perfil, status e acesso</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-semibold">Nome</th>
            <th scope="col" className="px-3 py-2 font-semibold">E-mail</th>
            <th scope="col" className="px-3 py-2 font-semibold">Perfil</th>
            <th scope="col" className="px-3 py-2 font-semibold">Status</th>
            <th scope="col" className="px-3 py-2 font-semibold">Último acesso</th>
            {canManageUsers ? (
              <th scope="col" className="px-3 py-2 font-semibold">Ações</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === currentUser.id;
            const rowBusy = pendingId === user.id;

            return (
              <tr key={user.id} className="border-b align-middle last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">
                  {user.name || "—"}
                  {isSelf ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{user.email ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={user.role}
                      onValueChange={(value) => void changeRole(user.id, value as Role)}
                      disabled={!canManageUsers || isSelf || rowBusy}
                    >
                      <SelectTrigger
                        className="h-8 w-[170px] text-sm"
                        aria-label={`Perfil de ${user.email ?? user.name ?? ""}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {rowBusy ? (
                      <Loader2
                        className="h-4 w-4 animate-spin text-muted-foreground"
                        aria-label="Salvando"
                      />
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={user.active ? "success" : "muted"}>
                      {user.active ? "Ativo" : "Inativo"}
                    </Badge>
                    {user.mustChangePassword ? (
                      <Badge variant="warning">Senha temporária</Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "Nunca entrou"}
                </td>
                {canManageUsers ? (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => void openRecovery(user)}
                        disabled={rowBusy || !user.email}
                        aria-label={`Gerar link de redefinição para ${user.email ?? user.name ?? ""}`}
                        title="Gerar link de redefinição"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </Button>
                      {isSelf ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() =>
                            setToggleTarget({ user, active: !user.active })
                          }
                          disabled={rowBusy}
                          aria-label={
                            user.active
                              ? `Desativar ${user.email ?? user.name ?? ""}`
                              : `Reativar ${user.email ?? user.name ?? ""}`
                          }
                          title={user.active ? "Desativar" : "Reativar"}
                        >
                          {user.active ? (
                            <UserX className="h-4 w-4" aria-hidden />
                          ) : (
                            <UserCheck className="h-4 w-4" aria-hidden />
                          )}
                        </Button>
                      )}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!canManageUsers ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Somente administradores alteram perfis e status.
        </p>
      ) : null}

      {/* Confirmação de ativar/desativar */}
      <Dialog
        open={toggleTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pendingId) setToggleTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{toggleTarget?.active ? "Reativar usuário" : "Desativar usuário"}</DialogTitle>
            <DialogDescription>
              {toggleTarget?.active
                ? `${toggleTarget.user.email} volta a poder entrar normalmente.`
                : `${toggleTarget?.user.email} será impedido de entrar e as sessões abertas serão encerradas. O histórico é preservado.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToggleTarget(null)}
              disabled={pendingId !== null}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void confirmToggle()}
              disabled={pendingId !== null}
              variant={toggleTarget?.active ? "default" : "destructive"}
            >
              {pendingId !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {toggleTarget?.active ? "Reativar" : "Desativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link de recuperação copiável */}
      <Dialog
        open={recoveryTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecoveryTarget(null);
            setRecoveryLink(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link de redefinição</DialogTitle>
            <DialogDescription>
              {recoveryBusy
                ? "Gerando o link…"
                : `Para ${recoveryTarget?.email ?? ""}. Compartilhe por canal seguro — vale por cerca de 1 hora.`}
            </DialogDescription>
          </DialogHeader>

          {recoveryBusy ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Gerando…
            </div>
          ) : recoveryLink ? (
            <div className="grid gap-2">
              <input
                readOnly
                value={recoveryLink}
                aria-label="Link de redefinição"
                className="w-full select-all truncate rounded border bg-muted px-2 py-1.5 font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
              <Button type="button" size="sm" onClick={() => void copyLink()}>
                <Copy className="h-4 w-4" aria-hidden />
                Copiar link
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
