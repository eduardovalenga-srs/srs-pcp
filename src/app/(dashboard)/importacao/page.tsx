
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listBatchErrors, listBatches } from "@/lib/repositories/import.repository";
import { getAllProductGroups } from "@/lib/repositories/product-groups.repository";
import type { ImportBatchHistory } from "@/lib/types/import";
import type { ProductGroupDefinition } from "@/lib/types/product-group";
import { errorMessage } from "@/lib/utils/supabase-result";
import { Header } from "@/components/layout/Header";
import { ImportHistory } from "@/components/importacao/ImportHistory";
import { ImportWizard } from "@/components/importacao/ImportWizard";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { hasPermission } from "@/lib/auth/access";

export const metadata = { title: "Importar planilha" };

export default async function ImportacaoPage() {
  const sessionUser = await getSessionUser();

  if (!sessionUser || !hasPermission(sessionUser.access, "import.access")) {
    return (
      <>
        <Header title="Importar planilha" description="Importe a planilha da fábrica com a estrutura completa da OF." />
        <AccessDenied message="Seu perfil não tem permissão para importar planilhas." />
      </>
    );
  }

  const capabilities = {
    canViewOrders: hasPermission(sessionUser.access, "orders.view"),
    canViewProduction: hasPermission(sessionUser.access, "production.view"),
  };

  let batches: ImportBatchHistory[] = [];
  let historyError: string | null = null;
  let productGroups: ProductGroupDefinition[] = [];

  try {
    const client = await createClient();

    try {
      [batches, productGroups] = await Promise.all([
        listBatches(client),
        getAllProductGroups(client),
      ]);
      const [mostRecent] = batches;
      if (mostRecent) {
        mostRecent.errors = await listBatchErrors(client, mostRecent.id);
      }
    } catch (error) {
      historyError = errorMessage(error, "Não foi possível carregar o histórico de importações.");
      batches = [];
      productGroups = [];
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
        {productGroups.length === 0 ? (
          <p
            role="alert"
            className="rounded border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
          >
            Cadastre ao menos uma família em <strong>Grupos de produtos</strong> antes de importar — a
            importação exige a família do produto.
          </p>
        ) : null}

        <ImportWizard capabilities={capabilities} productGroups={productGroups} />

        <section aria-labelledby="historico-heading" className="space-y-2">
          <h2 id="historico-heading" className="text-sm font-semibold tracking-tight">
            Histórico de importações
          </h2>
          {/* key pelo lote mais recente: quando o assistente conclui uma
              importação e chama router.refresh(), as props novas do servidor
              remontam a lista (o useState inicial não acompanha props). */}
          <ImportHistory key={batches[0]?.id ?? "vazio"} initialBatches={batches} initialError={historyError} />
        </section>
      </div>
    </>
  );
}
