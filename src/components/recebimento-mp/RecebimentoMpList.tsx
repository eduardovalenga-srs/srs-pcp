"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteMpReceiptAction } from "@/lib/actions/mp-receipt.actions";
import type { MpReceiptListEntry } from "@/lib/types/mp-receipt";
import { formatBusinessDate } from "@/lib/utils/dates";
import { formatWeight } from "@/lib/utils/formatting";
import { errorMessage } from "@/lib/utils/supabase-result";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RecebimentoMpListProps {
  entries: MpReceiptListEntry[];
  canEdit: boolean;
}

function ReceiptActions({
  entry,
  canEdit,
}: {
  entry: MpReceiptListEntry;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const entryNumber = entry.entryNumber || String(entry.number);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteMpReceiptAction(entry.id);
      if (!result.success) {
        toast.error(result.message || "Não foi possível excluir a nota de entrada.");
        setDeleteOpen(false);
        return;
      }
      toast.success(result.message);
      setDeleteOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button type="button" variant="outline" size="sm" asChild>
        <Link href={`/recebimento-mp/${entry.id}`}>
          <Eye className="h-4 w-4" aria-hidden />
          Consultar
        </Link>
      </Button>
      {canEdit ? (
        <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Excluir nota de entrada ${entryNumber}`}
            title={`Excluir nota de entrada ${entryNumber}`}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir nota de entrada nº {entryNumber}?</DialogTitle>
              <DialogDescription>
                O recebimento será removido e o saldo de matéria-prima da OF será recalculado. Esta
                ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {deleting ? "Excluindo…" : "Excluir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Lista geral de notas de entrada registradas para matéria-prima. */
export function RecebimentoMpList({ entries, canEdit }: RecebimentoMpListProps) {
  return (
    <section aria-label="Registros de recebimento" className="space-y-3">
      <h2 className="text-sm font-semibold">Recebimentos cadastrados</h2>

      {entries.length === 0 ? (
        <EmptyState
          title="Nenhum recebimento cadastrado"
          description="Os recebimentos registrados aparecerão nesta lista."
        />
      ) : (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">
                  OF
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Cliente
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Nº
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Data
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Usuário
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Matérias-primas (kg)
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-b-0 align-top">
                  <td className="px-3 py-2 tabular-nums">{entry.orderCode ?? "—"}</td>
                  <td className="px-3 py-2">{entry.customerName || "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {entry.entryNumber || entry.number}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {entry.entryDate ? formatBusinessDate(entry.entryDate) : "—"}
                  </td>
                  <td className="px-3 py-2">{entry.userName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {entry.materials.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {entry.materials.map((material, index) => (
                          <li key={`${entry.id}-${index}`} className="tabular-nums">
                            {material.description}: {formatWeight(material.quantityKg)} kg
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ReceiptActions entry={entry} canEdit={canEdit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
