import type { MpReceiptDetail } from "@/lib/types/mp-receipt";
import { formatBusinessDate, formatDateTime } from "@/lib/utils/dates";
import { formatWeight } from "@/lib/utils/formatting";

interface RecebimentoMpDetailProps {
  entry: MpReceiptDetail;
}

/** Consulta somente leitura de uma nota de entrada de MP. */
export function RecebimentoMpDetail({ entry }: RecebimentoMpDetailProps) {
  return (
    <div className="space-y-3">
      <section aria-label="Dados da nota de entrada" className="rounded border bg-card p-3">
        <h2 className="mb-3 text-sm font-semibold">Dados da nota</h2>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Nº</dt>
            <dd className="tabular-nums">{entry.entryNumber || entry.number}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Data</dt>
            <dd className="tabular-nums">
              {entry.entryDate ? formatBusinessDate(entry.entryDate) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Usuário</dt>
            <dd>{entry.userName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">OF</dt>
            <dd className="tabular-nums">{entry.orderCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cliente</dt>
            <dd>{entry.customerName || "Cliente não informado"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Registro criado em</dt>
            <dd className="tabular-nums">{formatDateTime(entry.createdAt)}</dd>
          </div>
          {entry.notes ? (
            <div className="sm:col-span-2 xl:col-span-4">
              <dt className="text-xs text-muted-foreground">Observação</dt>
              <dd>{entry.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-label="Matérias-primas da OF" className="space-y-2">
        <h2 className="text-sm font-semibold">Matérias-primas da OF</h2>
        {entry.materials.length === 0 ? (
          <p className="rounded border bg-card p-3 text-sm text-muted-foreground">
            Nenhuma matéria-prima da OF foi informada nesta nota.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Matéria-prima
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    UM
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Quantidade (kg)
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.materials.map((material, index) => (
                  <tr key={`${entry.id}-material-${index}`} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{material.description}</td>
                    <td className="px-3 py-2 text-muted-foreground">{material.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(material.quantityKg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {entry.freeItems.length > 0 ? (
        <section aria-label="Materiais fora da OF" className="space-y-2">
          <h2 className="text-sm font-semibold">Materiais fora da OF</h2>
          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Matéria-prima
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    UM
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Quantidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.freeItems.map((item, index) => (
                  <tr key={`${entry.id}-free-${index}`} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{item.description}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWeight(item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
