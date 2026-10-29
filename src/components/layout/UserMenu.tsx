"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Cog, KeyRound, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";

import { logoutAction } from "@/lib/actions/auth.actions";
import { can } from "@/lib/auth/permissions";
import { ROLE_LABELS, type Role } from "@/lib/constants/orders";
import { cn } from "@/lib/utils";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MenuUser {
  name: string;
  email: string;
  role: Role;
}

interface UserMenuProps {
  user: MenuUser;
  /** Sempre mostrar o nome (rodapé da sidebar expandida, barra mobile). */
  showLabel?: boolean;
  className?: string;
}

/**
 * Menu do usuário (043) — perfil, alterar senha, configurações (ADMIN) e sair.
 * Fica no RODAPÉ da sidebar e na barra mobile; antes vivia no TopNav.
 *
 * Sair é imperativo: o menu desmonta no clique, então não dá para confiar em
 * `<form action>` ali.
 */
export function UserMenu({ user, showLabel = true, className }: UserMenuProps) {
  const router = useRouter();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAction();
    } catch (error) {
      console.error("[UserMenu] logout", error);
      toast.error("Não foi possível encerrar a sessão. Tente novamente.");
    } finally {
      setLoggingOut(false);
      router.push("/login");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("w-full gap-1.5", showLabel ? "justify-start" : "justify-center px-0", className)}
            aria-label={`Menu do usuário — ${user.name}`}
            title="Menu do usuário"
          >
            <UserRound className="h-4 w-4 shrink-0" aria-hidden />
            {showLabel ? <span className="truncate font-medium">{user.name}</span> : null}
            {showLabel ? <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" side="right" className="w-60">
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="truncate text-sm font-semibold">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            <span className="mt-1">
              <Badge variant="secondary" className="w-fit">
                {ROLE_LABELS[user.role]}
              </Badge>
            </span>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
            <KeyRound aria-hidden />
            Alterar senha
          </DropdownMenuItem>

          {can(user.role, "menu.settings") ? (
            <DropdownMenuItem asChild>
              <Link href="/configuracoes">
                <Cog aria-hidden />
                Configurações
              </Link>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem disabled={loggingOut} onSelect={() => void handleLogout()}>
            <LogOut aria-hidden />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog controlledOpen={passwordOpen} onControlledOpenChange={setPasswordOpen} />
    </>
  );
}
