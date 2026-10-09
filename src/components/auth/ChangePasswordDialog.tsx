"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { changeMyPasswordAction } from "@/lib/actions/users.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChangePasswordDialogProps {
  /** Rótulo do botão (também usado no aria-label quando só ícone). */
  label?: string;
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  /** false = botão só com ícone (TopNav desktop). */
  showLabel?: boolean;
  className?: string;
  /** Modo controlado (ex.: item de menu) — não renderiza botão gatilho. */
  controlledOpen?: boolean;
  onControlledOpenChange?: (open: boolean) => void;
}

/** Troca da senha da conta logada (diálogo reutilizado no menu e no banner). */
export function ChangePasswordDialog({
  label = "Alterar senha",
  variant = "ghost",
  showLabel = true,
  className,
  controlledOpen,
  onControlledOpenChange,
}: ChangePasswordDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onControlledOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      const result = await changeMyPasswordAction({ newPassword, confirmPassword });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size="sm"
            className={className}
            aria-label={label}
            title={label}
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            {showLabel ? label : null}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
          <DialogDescription>Escolha uma senha que você não use em outro sistema.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="nova-senha">Nova senha</Label>
            <Input
              id="nova-senha"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={8}
              maxLength={72}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
            <Input
              id="confirmar-senha"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ? "Salvando…" : "Salvar senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
