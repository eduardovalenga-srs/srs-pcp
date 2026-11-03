"use client";

import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import {
  forgotPasswordAction,
  loginAction,
  type AuthFormState,
  type ForgotPasswordState,
} from "@/lib/actions/auth.actions";
import { requestSkipForcedReauth } from "@/lib/auth/forced-reauth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INITIAL_LOGIN: AuthFormState = { error: null };
const INITIAL_FORGOT: ForgotPasswordState = { error: null, message: null };

/**
 * "Lembrar-me" guarda e-mail + senha no sessionStorage — o registro some
 * quando o navegador fecha (nunca fica no disco como o localStorage eterno
 * da versão anterior, cuja chave também é apagada abaixo no mount).
 */
const REMEMBER_SESSION_KEY = "imperatriz:credenciais";
/** Chave antiga (só e-mail, localStorage) — apagada na limpeza do mount. */
const LEGACY_REMEMBER_EMAIL_KEY = "imperatriz:email";

/** Tokens visuais do layout Imperatriz (azul-marinho + laranja). */
const inputClass =
  "h-12 rounded-lg border-[#B9C6E6] bg-white text-lg placeholder:text-[#9AA3B2] focus-visible:border-[#F5821F] focus-visible:ring-[#F5821F]";
const submitClass =
  "h-12 rounded-lg bg-[#F5821F] text-lg font-bold text-white hover:bg-[#E0751A] focus-visible:ring-[#F5821F]";

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginState, loginFormAction, isPending] = useActionState(loginAction, INITIAL_LOGIN);
  const [forgotState, forgotFormAction, forgotPending] = useActionState(
    forgotPasswordAction,
    INITIAL_FORGOT,
  );

  // "Lembrar-me": pré-preenche e-mail e senha salvos na entrada anterior.
  // O prefill roda pós-hidratação via timer: setState síncrono no corpo do
  // effect é vedado (set-state-in-effect) e valor no primeiro render quebraria
  // a hidratação do SSR. A chave antiga (só e-mail, localStorage eterno) não
  // vale mais e sai do navegador nesta primeira visita.
  useEffect(() => {
    window.localStorage.removeItem(LEGACY_REMEMBER_EMAIL_KEY);
    const saved = window.sessionStorage.getItem(REMEMBER_SESSION_KEY);
    if (!saved) return undefined;
    let credentials: { email?: string; password?: string } | null = null;
    try {
      credentials = JSON.parse(saved) as { email?: string; password?: string };
    } catch {
      // Registro corrompido: descarta em vez de quebrar o login.
      window.sessionStorage.removeItem(REMEMBER_SESSION_KEY);
      return undefined;
    }
    const savedEmail = credentials?.email;
    if (!savedEmail) return undefined;
    const savedPassword = credentials?.password ?? "";
    const timer = window.setTimeout(() => {
      setEmail(savedEmail);
      setPassword(savedPassword);
      setRemember(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submitLogin = (formData: FormData) => {
    // O sucesso redireciona (desmonta o form) — gravamos no envio. A senha
    // só sai do navegador ao fechar o navegador (sessionStorage) ou ao
    // desmarcar "Lembrar-me".
    const value = email.trim();
    if (remember && value) {
      window.sessionStorage.setItem(
        REMEMBER_SESSION_KEY,
        JSON.stringify({ email: value, password }),
      );
    } else {
      window.sessionStorage.removeItem(REMEMBER_SESSION_KEY);
    }
    // Marca o fluxo: o forced re-auth não deve derrubar a sessão recém-criada.
    requestSkipForcedReauth();
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
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Senha"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={cn(inputClass, "pr-11")}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
        </div>
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
