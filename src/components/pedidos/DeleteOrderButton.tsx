"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteOrderAction } from "@/lib/actions/orders.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteOrderButtonProps {
  orderId: string;
  orderCode: string;
  /** Para onde ir após excluir (padrão: permanecer e recarregar a tela). */
  redirectHref?: string;
}

/** Exclusão de pedido com confirmação prévia em diálogo. */
export function DeleteOrderButton({ orderId, orderCode, redirectHref }: DeleteOrderButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      const result = await deleteOrderAction(orderId);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      if (redirectHref) {
        router.push(redirectHref);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Excluir pedido ${orderCode}`}
        title={`Excluir pedido ${orderCode}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir pedido</DialogTitle>
          <DialogDescription>
            O pedido {orderCode} e seus itens serão removidos. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Excluindo…" : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
