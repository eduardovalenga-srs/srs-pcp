"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { firstZodMessage } from "@/lib/validators/common";
import { changePasswordSchema } from "@/lib/validators/user.schema";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status = "checking" | "ready" | "invalid";

function mapPasswordError(message: string): string {
  if (/different from the old/i.test(message)) return "A nova senha deve ser diferente da atual.";
  return "Não foi possível definir a senha. Tente novamente pelo link.";
}

/** Define a nova senha no fluxo de recuperação (link do e-mail). */
export function ResetPasswordForm({ code }: { code: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const exchanged = useRef(false);

  // Troca o ?code= do PKCE por uma sessão (cliente de navegador).
  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const supabase = createBrowserClient();
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => setStatus(error ? "invalid" : "ready"))
      .catch(() => setStatus("invalid"));
  }, [code]);

  const submit = async () => {
    const parsed = changePasswordSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      toast.error(firstZodMessage(parsed.error) ?? "Dados inválidos.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.updateUser({
        password: parsed.data.newPassword,
      });
      if (error) {
        toast.error(mapPasswordError(error.message));
        return;
      }

      // Sem aviso de senha temporária a partir daqui (linha própria — RLS).
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ must_change_password: false })
          .eq("id", user.id);
      }

      toast.success("Senha definida com sucesso.");
      router.replace("/gestao-entregas");
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Validando o link…
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <p className="text-sm text-destructive">
          O link de redefinição é inválido ou expirou. Peça um novo em “Esqueci minha senha”.
        </p>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href="/login">
            <LogIn className="h-4 w-4" aria-hidden />
            Voltar para o login
          </a>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-done" aria-hidden />
        <p className="text-muted-foreground">Defina a nova senha da sua conta.</p>
      </div>

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
          autoFocus
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

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
        {busy ? "Salvando…" : "Definir senha"}
      </Button>
    </form>
  );
}
