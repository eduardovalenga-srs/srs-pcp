"use client";

import type { RomaneioOrderItem } from "@/lib/types/romaneio";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Input } from "@/components/ui/input";
import { ProcessStatusBadge } from "@/components/shared/StatusBadges";

interface RomaneioItemsEditorProps {
  items: RomaneioOrderItem[];
  canEdit: boolean;
  /** Quantidades digitadas: orderItemId -> texto do input ("", "10", "2,5"). */
  quantities: Record<string, string>;
  onQuantityChange: (orderItemId: string, value: string) => void;
}

/**
 * Editor de itens do romaneio — só itens RAIZ da OF (o EXP mora no pai).
 * "0"/vazio = item fora desta carga; a pendência ao lado lembra o teto da
 * expedição parcial (qtd do item − já emitida em outros romaneios).
 */
export function RomaneioItemsEditor({
  items,
  canEdit,
  quantities,
  onQuantityChange,
}: RomaneioItemsEditorProps) {
  return (
    <>
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Itens raiz da OF com situação da expedição, quantidades e pesos.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">Família</th>
              <th scope="col" className="px-3 py-2 font-semibold">Item pai</th>
              <th scope="col" className="px-3 py-2 font-semibold">Descrição</th>
              <th scope="col" className="px-3 py-2 font-semibold">EXP</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Qtd OF</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Já expedida</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Pendência</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Nesta carga</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Peso carga (kg)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const quantityText = quantities[item.orderItemId] ?? "";
              const quantity = Number.parseFloat(quantityText.replace(",", ".")) || 0;
              const pending = Math.max(item.itemQuantity - item.shippedQuantity, 0);
              const overLimit = quantity + item.shippedQuantity > item.itemQuantity;
              return (
                <tr key={item.orderItemId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">{item.family || "—"}</td>
                  <td className="px-3 py-2">{item.parentItem || "—"}</td>
                  <td className="max-w-[260px] px-3 py-2">
                    <span className="block truncate" title={item.description}>
                      {item.description || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {item.expStatus ? (
                      <ProcessStatusBadge status={item.expStatus} />
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title="O item não possui etapa de EXPEDIÇÃO"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(item.itemQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(item.shippedQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(pending)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${item.description} nesta carga`}
                        value={quantityText}
                        disabled={!canEdit}
                        onChange={(event) => onQuantityChange(item.orderItemId, event.target.value)}
                        placeholder="0"
                        className={`h-8 w-24 text-right tabular-nums${overLimit ? " border-destructive" : ""}`}
                      />
                    </div>
                    {overLimit ? (
                      <p className="mt-1 text-right text-xs text-destructive">
                        Acima da pendência
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.unitWeightKg === null ? "—" : formatWeight(item.unitWeightKg * quantity)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {items.map((item) => {
          const quantityText = quantities[item.orderItemId] ?? "";
          const quantity = Number.parseFloat(quantityText.replace(",", ".")) || 0;
          const pending = Math.max(item.itemQuantity - item.shippedQuantity, 0);
          const overLimit = quantity + item.shippedQuantity > item.itemQuantity;
          return (
            <li key={item.orderItemId} className="rounded border bg-card p-3">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium">{item.description || "—"}</p>
                {item.expStatus ? (
                  <ProcessStatusBadge status={item.expStatus} />
                ) : (
                  <span className="text-xs text-muted-foreground" title="Sem etapa de EXPEDIÇÃO">
                    EXP —
                  </span>
                )}
              </header>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {[item.family, item.parentItem].filter(Boolean).join(" · ") || "Sem família"}
              </p>

              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Qtd OF</dt>
                  <dd className="tabular-nums">{formatQuantity(item.itemQuantity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Já expedida</dt>
                  <dd className="tabular-nums">{formatQuantity(item.shippedQuantity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Pendência</dt>
                  <dd className="tabular-nums">{formatQuantity(pending)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor={`item-${item.orderItemId}`}
                    className="text-xs text-muted-foreground"
                  >
                    Nesta carga
                  </label>
                  <Input
                    id={`item-${item.orderItemId}`}
                    type="text"
                    inputMode="decimal"
                    value={quantityText}
                    disabled={!canEdit}
                    onChange={(event) => onQuantityChange(item.orderItemId, event.target.value)}
                    placeholder="0"
                    className={`h-8 w-24 text-right tabular-nums${overLimit ? " border-destructive" : ""}`}
                  />
                </div>
                <p className="text-sm tabular-nums text-muted-foreground">
                  Peso: {item.unitWeightKg === null ? "—" : `${formatWeight(item.unitWeightKg * quantity)} kg`}
                </p>
              </div>
              {overLimit ? (
                <p className="mt-1 text-right text-xs text-destructive">Acima da pendência</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
