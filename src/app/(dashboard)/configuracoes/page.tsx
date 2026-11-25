import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { getConfigData } from "@/lib/actions/settings.actions";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { UsersTable } from "@/components/configuracoes/UsersTable";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils/dates";

export const metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (sessionUser.role !== "ADMIN" || sessionUser.access.accountType !== "INTERNAL") {
    return (
      <>
        <Header title="Configurações" description="Usuários, permissões e catálogos." />
        <AccessDenied />
      </>
    );
  }

  const data = await getConfigData();
  if ("error" in data) {
    return (
      <>
        <Header title="Configurações" description="Usuários, permissões e catálogos." />
        <ErrorState title="Não foi possível carregar as configurações" message={data.error} />
      </>
    );
  }

  return (
    <>
      <Header
        title="Configurações"
        description="Perfis de acesso, usuários e processos do fluxo fabril."
      />

      <div className="space-y-4">
        <UsersTable
          users={data.users}
          currentUser={{ id: sessionUser.id, email: sessionUser.email }}
          canManageUsers={sessionUser.role === "ADMIN" && sessionUser.access.accountType === "INTERNAL"}
          clientRoots={data.clientRoots}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Processos ativos</CardTitle>
              <CardDescription>Colunas exibidas na tela de gestão de OF.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {data.processes.map((process) => (
                <Badge key={process.id} variant="outline">
                  {process.code} — {process.name}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado do sistema</CardTitle>
              <CardDescription>Verificações de acesso iniciais.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Administrador cadastrado</span>
                <Badge variant={data.hasAdminUser ? "success" : "warning"}>
                  {data.hasAdminUser ? "Sim" : "Não"}
                </Badge>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Seu perfil</span>
                <Badge variant="secondary">{sessionUser.role}</Badge>
              </p>
              {!data.hasAdminUser ? (
                <p className="text-xs text-muted-foreground">
                  O primeiro usuário a entrar pode se promover a administrador pelo aviso no painel.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auditoria de acessos</CardTitle>
            <CardDescription>
              Alterações recentes de permissões, tipo de conta e escopo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.accessAudit.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Alterações recentes nos acessos de usuários</caption>
                  <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">Data</th>
                      <th className="px-2 py-1.5">Ação</th>
                      <th className="px-2 py-1.5">Usuário</th>
                      <th className="px-2 py-1.5">Administrador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accessAudit.map((entry) => {
                      const target = data.users.find((user) => user.id === entry.targetProfileId);
                      const actor = data.users.find((user) => user.id === entry.actorProfileId);
                      const labels: Record<string, string> = {
                        ACCESS_CONFIG_UPDATED: "Acesso atualizado",
                        USER_ROLE_CHANGED: "Perfil alterado",
                        USER_ACTIVE_CHANGED: "Status alterado",
                      };
                      return (
                        <tr key={entry.id} className="border-t">
                          <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                            {formatDateTime(entry.createdAt)}
                          </td>
                          <td className="px-2 py-1.5">{labels[entry.action] ?? entry.action}</td>
                          <td className="px-2 py-1.5">{target?.email ?? entry.targetProfileId ?? "—"}</td>
                          <td className="px-2 py-1.5">{actor?.email ?? entry.actorProfileId ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
