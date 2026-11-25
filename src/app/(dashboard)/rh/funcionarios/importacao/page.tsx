import { redirect } from "next/navigation";

import { AccessDenied } from "@/components/shared/AccessDenied";
import { Header } from "@/components/layout/Header";
import { EmployeeImport } from "@/components/rh/EmployeeImport";
import { hasPermission } from "@/lib/auth/access";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Importar funcionários" };

export default async function ImportarFuncionariosPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.access, "rh.employees.import")) {
    return <><Header title="Importar funcionários" /><AccessDenied /></>;
  }
  return (
    <>
      <Header
        title="Importar funcionários"
        description="Importe a planilha como base e complemente a alocação com a listagem em PDF."
      />
      <EmployeeImport />
    </>
  );
}
