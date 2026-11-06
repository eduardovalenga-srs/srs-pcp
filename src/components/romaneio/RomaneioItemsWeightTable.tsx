import type { RomaneioOrderItem } from "@/lib/types/romaneio";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";

interface RomaneioItemsWeightTableProps {
  /** Itens da carga — os com quantidade 0 ficam de fora. */
  items: readonly RomaneioOrderItem[];
  /**
   * Peso total da carga (kg) — MESMA fonte do cabeçalho (Σ da
   * utilizada em unidade de peso, com fallback no qtd × peso unitário
   * dos itens); null = sem peso (rodapé fora). É o número que fecha a
   * coluna "Peso total (kg)" com a tabela de materiais.
   */
  totalKg: number | null;
  /**
   * Wrapper da tabela (padrão: só rolagem horizontal). O detalhe passa
   * card com `print:` para sair limpo junto da ficha impressa.
   */
  className?: string;
}

/**
 * Tabela de PESO dos itens da carga (somente leitura) — completa a
 * seção de devolução de matéria-prima do detalhe e da ficha de
 * conferência: por item, o peso alocado dos materiais em KG da
 * subárvore dele (coluna "Peso carga" do detalhe; sem material em
 * peso, volta ao qtd × peso unitário) e o total da carga ao pé. Item
 * sem peso nenhum fica "—"; sem itens incluídos não renderiza.
 */
export function RomaneioItemsWeightTable({
  items,
  totalKg,
  className = "overflow-x-auto",
}: RomaneioItemsWeightTableProps) {
  const included = items.filter((item) => item.quantity > 0);
  if (included.length === 0) return null;

  const hasAnyWeight = totalKg !== null;

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">Peso dos itens da carga</h3>
      <div className={className}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Peso dos itens desta carga: quantidade, peso unitário e peso alocado por item.
          </caption>
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground print:border-black">
              <th scope="col" className="py-1 pr-2 font-semibold">Descrição</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Qtd</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Peso unit. (kg)</th>
              <th scope="col" className="py-1 text-right font-semibold">Peso carga (kg)</th>
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
                  {item.loadWeightKg === null ? "—" : formatWeight(item.loadWeightKg)}
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
                  {formatWeight(totalKg)} kg
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
