"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  forgotPasswordAction,
  loginAction,
  type AuthFormState,
  type ForgotPasswordState,
} from "@/lib/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL_LOGIN: AuthFormState = { error: null };
const INITIAL_FORGOT: ForgotPasswordState = { error: null, message: null };

/** "Lembrar-me" guarda só o e-mail no navegador — nunca a senha. */
const REMEMBER_EMAIL_KEY = "imperatriz:email";

/** Tokens visuais do layout Imperatriz (azul-marinho + laranja). */
const inputClass =
  "h-12 rounded-lg border-[#B9C6E6] bg-white text-lg placeholder:text-[#9AA3B2] focus-visible:border-[#F5821F] focus-visible:ring-[#F5821F]";
const submitClass =
  "h-12 rounded-lg bg-[#F5821F] text-lg font-bold text-white hover:bg-[#E0751A] focus-visible:ring-[#F5821F]";

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);
  const [loginState, loginFormAction, isPending] = useActionState(loginAction, INITIAL_LOGIN);
  const [forgotState, forgotFormAction, forgotPending] = useActionState(
    forgotPasswordAction,
    INITIAL_FORGOT,
  );

  // "Lembrar-me": pré-preenche o e-mail salvo na entrada anterior. O prefill
  // roda pós-hidratação via timer: setState síncrono no corpo do effect é
  // vedado (set-state-in-effect) e valor no primeiro render quebraria a
  // hidratação do SSR.
  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (!saved) return undefined;
    const timer = window.setTimeout(() => {
      setEmail(saved);
      setRemember(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submitLogin = (formData: FormData) => {
    // O sucesso redireciona (desmonta o form) — gravamos no envio.
    const value = email.trim();
    if (remember && value) {
      window.localStorage.setItem(REMEMBER_EMAIL_KEY, value);
    } else {
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
    loginFormAction(formData);
  };

  if (mode === "forgot") {
    return (
      <form action={forgotFormAction} className="mt-6 grid gap-3" aria-describedby="forgot-feedback">
        <div>
          <Label htmlFor="forgot-email" className="sr-only">
            E-mail
          </Label>
          <Input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="email@srsterceiros.com.br"
            required
            autoFocus
            className={inputClass}
          />
        </div>

        <div id="forgot-feedback" aria-live="polite" className="min-h-5 text-center text-sm">
          {forgotState.error ? (
            <p className="font-medium text-destructive">{forgotState.error}</p>
          ) : null}
          {forgotState.message ? (
            <p className="text-status-done">{forgotState.message}</p>
          ) : null}
        </div>

        <Button type="submit" disabled={forgotPending} className={submitClass}>
          {forgotPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {forgotPending ? "Enviando…" : "Enviar link de recuperação"}
        </Button>

        <Button
          type="button"
          variant="link"
          size="sm"
          className="mx-auto h-auto p-0 text-xs text-muted-foreground"
          onClick={() => setMode("login")}
          disabled={forgotPending}
        >
          Voltar para o login
        </Button>
      </form>
    );
  }

  return (
    <form action={submitLogin} className="mt-6 grid gap-3" aria-describedby="login-error">
      <div>
        <Label htmlFor="email" className="sr-only">
          E-mail
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="email@srsterceiros.com.br"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <Label htmlFor="password" className="sr-only">
          Senha
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          required
          className={inputClass}
        />
      </div>

      <label
        htmlFor="remember"
        className="flex w-fit cursor-pointer items-center gap-2 text-sm font-semibold text-[#1B2A5E]"
      >
        <Checkbox
          id="remember"
          name="remember"
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked === true)}
          className="h-5 w-5 rounded-md border-[#B9C6E6] data-[state=checked]:border-[#F5821F] data-[state=checked]:bg-[#F5821F]"
        />
        Lembrar-me
      </label>

      <Button type="submit" disabled={isPending} className={submitClass}>
        {isPending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            Conectando…
          </>
        ) : (
          "Conectar"
        )}
      </Button>

      <div
        id="login-error"
        role="alert"
        aria-live="polite"
        className="min-h-5 text-center text-sm font-medium text-destructive"
      >
        {loginState.error}
      </div>

      <Button
        type="button"
        variant="link"
        size="sm"
        className="mx-auto h-auto p-0 text-xs text-muted-foreground"
        onClick={() => setMode("forgot")}
      >
        Esqueci minha senha
      </Button>
    </form>
  );
}
