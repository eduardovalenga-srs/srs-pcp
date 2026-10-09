import { redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getConfigData } from "@/lib/actions/settings.actions";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { UsersTable } from "@/components/configuracoes/UsersTable";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ConfiguracoesPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "settings.manage")) {
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
          canManageUsers={can(sessionUser.role, "users.manage")}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Processos ativos</CardTitle>
              <CardDescription>Colunas exibidas na tela de gestão de entregas.</CardDescription>
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
      </div>
    </>
  );
}
