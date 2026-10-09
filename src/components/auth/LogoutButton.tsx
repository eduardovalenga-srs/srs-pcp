"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { logoutAction } from "@/lib/actions/auth.actions";
import { Button } from "@/components/ui/button";

/**
 * Sair imperativo (mesmo padrão do TopNav): encerra a sessão no Supabase
 * e leva ao /login. Usado na rota terminal /acesso-negado, onde o layout
 * autenticado não existe.
 */
export function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAction();
    } catch (error) {
      console.error("[LogoutButton] logout", error);
    } finally {
      setLoggingOut(false);
      router.push("/login");
    }
  };

  return (
    <Button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
      {loggingOut ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {loggingOut ? "Saindo…" : "Sair"}
    </Button>
  );
}
