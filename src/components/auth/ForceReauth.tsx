"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createBrowserClient } from "@/lib/supabase/client";
import { consumeSkipForcedReauth } from "@/lib/auth/forced-reauth";

/**
 * Força re-autenticação a cada abertura do sistema: no mount da área
 * autenticada o client limpa a sessão (via `signOut` — os cookies são
 * gerenciados pelo @supabase/ssr) e manda ao /login. O guard do dashboard
 * passa a enxergar "anonimo" e a tela de login é exibida no lugar do painel.
 *
 * A marcação do fluxo (setada pelo LoginForm no submit) suprime o logout
 * automático logo após um login bem-sucedido — senão o redirect pós-login
 * para o painel reativaria o ciclo infinito login ↔ forçado.
 */
export function ForceReauth() {
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    // React StrictMode (dev) executa o effect duas vezes (mount → cleanup →
    // remount); garante que o fluxo forçado rode UMA única vez por montagem —
    // senão a flag de skip (já consumida no 1º pass) faria o signOut/redirect
    // rodar de novo e derrubar a sessão logo após o painel carregar.
    if (handledRef.current) return;
    handledRef.current = true;
    if (consumeSkipForcedReauth()) return;

    let cancelled = false;
    const run = async () => {
      try {
        const supabase = createBrowserClient();
        await supabase.auth.signOut();
      } catch (error) {
        console.error("[ForceReauth] signOut", error);
      }
      if (!cancelled) router.replace("/login");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
