"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { saveItemMaterialsAction } from "@/lib/actions/orders.actions";
import { MATERIAL_UNIT_LABELS, type MaterialUnit } from "@/lib/constants/materials";
import type { OrderItemMaterial } from "@/lib/types/order";
import { formatQuantity } from "@/lib/utils/formatting";
import type { MaterialInput } from "@/lib/validators/material.schema";
import { Button } from "@/components/ui/button";
import { MaterialsEditor } from "@/components/pedidos/MaterialsEditor";

interface OrderDetailMaterialsProps {
  orderItemId: string;
  materials: OrderItemMaterial[];
  canEdit: boolean;
}

function unitLabel(unit: string): string {
  return MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
}

/** Matérias-primas de um sub-item na tela de detalhes: consulta + edição. */
export function OrderDetailMaterials({ orderItemId, materials, canEdit }: OrderDetailMaterialsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<MaterialInput[]>([]);

  const startEditing = () => {
    setDraft(
      materials.map((material) => ({
        description: material.description,
        quantity: material.quantity,
        unit: material.unit as MaterialInput["unit"],
        notes: material.notes ?? "",
      })),
    );
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await saveItemMaterialsAction(orderItemId, draft);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-3 rounded border bg-muted/30 p-3">
        <MaterialsEditor value={draft} onChange={setDraft} disabled={busy} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Salvando…" : "Salvar materiais"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Matérias-primas</h4>
        {canEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
            <Pencil className="h-4 w-4" aria-hidden />
            {materials.length > 0 ? "Editar materiais" : "Adicionar materiais"}
          </Button>
        ) : null}
      </div>

      {materials.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum material cadastrado.</p>
      ) : (
        <ul className="divide-y rounded border">
          {materials.map((material) => (
            <li key={material.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-sm">
              <span className="font-medium">{material.description}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatQuantity(material.quantity)} {unitLabel(material.unit)}
              </span>
              {material.notes ? (
                <span className="w-full text-xs text-muted-foreground">{material.notes}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
