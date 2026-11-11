import type { OrderItemMaterial } from "@/lib/types/order";

/**
 * Materiais (matéria-prima) de um item — a MESMA renderização da
 * coluna "Matérias-primas" da Fábrica 1: só a DESCRIÇÃO de cada linha
 * (ex.: "CH4.75 CIVIL300") — sem quantidade/unidade e sem a linha de
 * observações, para não poluir. Item sem material fica sinalizado
 * (pendência de compra).
 */
export function MaterialsList({ materials }: { materials: OrderItemMaterial[] }) {
  if (materials.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum material cadastrado.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {materials.map((material) => (
        <li key={material.id} className="text-xs font-medium">
          {material.description}
        </li>
      ))}
    </ul>
  );
}
