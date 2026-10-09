"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createUserAction } from "@/lib/actions/users.actions";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants/orders";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreatedAccount {
  email: string;
  tempPassword: string;
}

/** Criação de conta com senha temporária (entregue fora do app). */
export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("OPERADOR");
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setRole("OPERADOR");
    setCreated(null);
    setCopied(false);
  };

  const close = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await createUserAction({ name, email, role });
      if (!result.success || !result.tempPassword) {
        toast.error(result.message);
        return;
      }
      setCreated({ email, tempPassword: result.tempPassword });
      toast.success(result.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyPassword = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Senha copiada.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          Novo usuário
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Conta criada</DialogTitle>
              <DialogDescription>
                {created.email} já pode entrar. Entregue a senha por um canal seguro.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="senha-temporaria">Senha temporária</Label>
                <div className="flex items-center gap-2">
                  <code
                    id="senha-temporaria"
                    className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded border bg-muted px-2 py-1.5 font-mono text-sm"
                  >
                    {created.tempPassword}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyPassword(created.tempPassword)}
                    aria-label="Copiar senha temporária"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>

              <p className="rounded border border-status-progress-bg bg-status-progress-bg px-2 py-1.5 text-xs text-foreground">
                <strong>Importante:</strong> esta senha aparece apenas uma vez. Na primeira
                entrada o usuário será obrigado a definir a própria senha.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>
                Concluir
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Novo usuário</DialogTitle>
              <DialogDescription>
                A conta nasce com senha temporária, que o usuário troca na primeira entrada.
              </DialogDescription>
            </DialogHeader>

            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="novo-usuario-nome">Nome</Label>
                <Input
                  id="novo-usuario-nome"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Maria Silva"
                  required
                  maxLength={80}
                  autoFocus
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="novo-usuario-email">E-mail</Label>
                <Input
                  id="novo-usuario-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@serralheria.com.br"
                  required
                  autoComplete="off"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="novo-usuario-perfil">Perfil</Label>
                <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                  <SelectTrigger id="novo-usuario-perfil" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {ROLE_LABELS[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  O perfil define o que a pessoa pode ver e editar.
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => close(false)}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <KeyRound className="h-4 w-4" aria-hidden />
                  )}
                  {busy ? "Criando…" : "Criar usuário"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
