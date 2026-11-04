import type { RomaneioOrderItem } from "@/lib/types/romaneio";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";

interface RomaneioItemsWeightTableProps {
  /** Itens da carga — os com quantidade 0 ficam de fora. */
  items: readonly RomaneioOrderItem[];
  /**
   * Wrapper da tabela (padrão: só rolagem horizontal). O detalhe passa
   * card com `print:` para sair limpo junto da ficha impressa.
   */
  className?: string;
}

/**
 * Tabela de PESO dos itens da carga (somente leitura) — completa a
 * seção de devolução de matéria-prima do detalhe e da ficha de
 * conferência: qtd nesta carga × peso unitário (coluna derivada da OF,
 * 023) e o total da carga ao pé. Sem peso unitário a célula sai "—";
 * sem itens incluídos não renderiza.
 */
export function RomaneioItemsWeightTable({
  items,
  className = "overflow-x-auto",
}: RomaneioItemsWeightTableProps) {
  const included = items.filter((item) => item.quantity > 0);
  if (included.length === 0) return null;

  const hasAnyWeight = included.some((item) => item.unitWeightKg !== null);
  const weightTotal = included.reduce(
    (sum, item) => sum + (item.unitWeightKg === null ? 0 : item.unitWeightKg * item.quantity),
    0,
  );

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">Peso dos itens da carga</h3>
      <div className={className}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Peso dos itens desta carga: quantidade, peso unitário e peso total por item.
          </caption>
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground print:border-black">
              <th scope="col" className="py-1 pr-2 font-semibold">Descrição</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Qtd</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Peso unit. (kg)</th>
              <th scope="col" className="py-1 text-right font-semibold">Peso total (kg)</th>
            </tr>
          </thead>
          <tbody>
            {included.map((item) => (
              <tr key={item.orderItemId} className="border-b last:border-0 print:border-black/40">
                <td className="py-1.5 pr-2">{item.description || "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {formatQuantity(item.quantity)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {item.unitWeightKg === null ? "—" : formatWeight(item.unitWeightKg)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {item.unitWeightKg === null ? "—" : formatWeight(item.unitWeightKg * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
          {hasAnyWeight ? (
            <tfoot>
              <tr className="border-t print:border-black">
                <td className="py-1.5 pr-2 font-semibold" colSpan={3}>
                  Peso total da carga
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatWeight(weightTotal)} kg
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {hasAnyWeight ? null : (
        <p className="text-xs text-muted-foreground">Itens sem peso unitário cadastrado.</p>
      )}
    </div>
  );
}
