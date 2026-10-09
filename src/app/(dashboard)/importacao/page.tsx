import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listBatchErrors, listBatches } from "@/lib/repositories/import.repository";
import type { ImportBatchHistory } from "@/lib/types/import";
import { errorMessage } from "@/lib/utils/supabase-result";
import { Header } from "@/components/layout/Header";
import { ImportHistory } from "@/components/importacao/ImportHistory";
import { ImportWizard } from "@/components/importacao/ImportWizard";
import { AccessDenied } from "@/components/shared/AccessDenied";

export const metadata = { title: "Importar planilha" };

export default async function ImportacaoPage() {
  const sessionUser = await getSessionUser();

  if (!sessionUser || !can(sessionUser.role, "import.access")) {
    return (
      <>
        <Header title="Importar planilha" description="Importe a planilha da fábrica com a estrutura completa da OF." />
        <AccessDenied message="Seu perfil não tem permissão para importar planilhas." />
      </>
    );
  }

  const capabilities = {
    canViewOrders: can(sessionUser.role, "orders.view"),
    canViewProduction: can(sessionUser.role, "production.view"),
  };

  let batches: ImportBatchHistory[] = [];
  let historyError: string | null = null;

  try {
    const client = await createClient();

    try {
      batches = await listBatches(client);
      const [mostRecent] = batches;
      if (mostRecent) {
        mostRecent.errors = await listBatchErrors(client, mostRecent.id);
      }
    } catch (error) {
      historyError = errorMessage(error, "Não foi possível carregar o histórico de importações.");
      batches = [];
    }
  } catch (error) {
    historyError = errorMessage(error, "Não foi possível conectar ao banco de dados.");
  }

  return (
    <>
      <Header
        title="Importar planilha"
        description="Envie o arquivo da fábrica, informe cliente e data de entrega, confira a prévia com as diferenças por OF e confirme."
      />

      <div className="space-y-4">
        <ImportWizard capabilities={capabilities} />

        <section aria-labelledby="historico-heading" className="space-y-2">
          <h2 id="historico-heading" className="text-sm font-semibold tracking-tight">
            Histórico de importações
          </h2>
          <ImportHistory initialBatches={batches} initialError={historyError} />
        </section>
      </div>
    </>
  );
}
