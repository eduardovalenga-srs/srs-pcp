"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { homePathFor } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/lib/validators/user.schema";

export interface AuthFormState {
  error: string | null;
}

export interface ForgotPasswordState {
  error: string | null;
  message: string | null;
}

const LOGIN_ERROR_MESSAGE = "E-mail ou senha inválidos.";

/** Autentica por e-mail/senha e redireciona para a página inicial do papel. */
export async function loginAction(_previousState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // A UI mostra apenas a mensagem genérica; a causa real fica no servidor.
    console.error("[loginAction]", error.message);
    return { error: LOGIN_ERROR_MESSAGE };
  }

  // Conta desativada? (migração 012) — derruba a sessão recém-criada.
  let homePath = homePathFor(null);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("active, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile && !profile.active) {
      await supabase.auth.signOut();
      console.warn(`[loginAction] tentativa de login em conta desativada: ${email}`);
      return { error: "Usuário desativado. Contate o administrador." };
    }

    // Destino por papel: OPERADOR (sem production.view) vai à Fábrica 1.
    homePath = homePathFor(profile?.role ?? null);
  }

  redirect(homePath);
}

/**
 * "Esqueci minha senha": envia o link de recuperação por e-mail
 * (depende do SMTP do Supabase). A mensagem de sucesso é a mesma com
 * e-mail existente ou não — não revela quem tem conta.
 */
export async function forgotPasswordAction(
  _previousState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) {
    return { error: "E-mail inválido.", message: null };
  }

  try {
    const supabase = await createClient();
    const headerList = await headers();
    const origin = `${headerList.get("x-forwarded-proto") ?? "http"}://${
      headerList.get("host") ?? "localhost:3000"
    }`;

    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${origin}/redefinir-senha`,
    });
    if (error) {
      // Falha de SMTP/configuração: orienta pelo caminho do administrador.
      console.error("[forgotPasswordAction]", error.message);
      return {
        error: "Não foi possível enviar o e-mail. Peça um link de redefinição ao administrador.",
        message: null,
      };
    }

    return {
      error: null,
      message: "Se o e-mail existir, enviaremos um link de recuperação. Confira sua caixa de entrada.",
    };
  } catch (error) {
    console.error("[forgotPasswordAction]", error);
    return {
      error: "Não foi possível enviar o e-mail. Tente novamente.",
      message: null,
    };
  }
}

/**
 * Encerra a sessão (limpa o cookie da sessão).
 * A navegação para /login é responsabilidade do cliente — o envio via
 * `<form action>` dentro do menu do usuário não é confiável (o Radix
 * desmonta o menu antes da ação nativa do clique), então a chamada é
 * imperativa.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  // Mesmo com erro na API a sessão local é removida (404/401/expirada);
  // registra apenas para diagnóstico.
  if (error) {
    console.error("[logoutAction]", error.message);
  }
}
