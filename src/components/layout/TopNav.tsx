"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Boxes,
  ChevronDown,
  Cog,
  Factory,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Warehouse,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { logoutAction } from "@/lib/actions/auth.actions";
import { can, type Capability } from "@/lib/auth/permissions";
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

import Image from "next/image";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Factory;
  /** Capacidade de menu ausente = sempre visível (hub obrigatório). */
  capability?: Capability;
}

/** Itens da barra — Configurações vive no menu do usuário (só ADMIN). */
const NAV_ITEMS: NavItem[] = [
  {
    href: "/gestao-entregas",
    label: "Gestão de Entregas",
    icon: Factory,
    capability: "menu.gestao",
  },
  { href: "/fabrica-2", label: "Fábrica 2", icon: Warehouse, capability: "menu.fabrica2" },
  { href: "/fabrica-1", label: "Fábrica 1", icon: Boxes, capability: "menu.fabrica1" },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, capability: "menu.dashboard" },
  { href: "/processos", label: "Processos", icon: Workflow, capability: "menu.processes" },
];

interface TopNavProps {
  user: { name: string; email: string; role: Role };
}

interface NavLinksProps {
  items: NavItem[];
  /** Sempre mostrar os rótulos (gaveta mobile); no desktop aparecem a partir de xl. */
  alwaysShowLabels?: boolean;
  onNavigate?: () => void;
  className?: string;
}

function NavLinks({ items, alwaysShowLabels = false, onNavigate, className }: NavLinksProps) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Navegação principal" className={cn("flex items-center gap-1", className)}>
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className={cn("hidden xl:inline", alwaysShowLabels && "inline")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Barra de navegação superior (sticky) — um único componente para desktop e mobile. */
export function TopNav({ user }: TopNavProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.capability || can(user.role, item.capability),
  );

  /** Sair imperativo: o menu desmonta no clique, então não dá para confiar em `<form action>` ali. */
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAction();
    } catch (error) {
      console.error("[TopNav] logout", error);
      toast.error("Não foi possível encerrar a sessão. Tente novamente.");
    } finally {
      setLoggingOut(false);
      router.push("/login");
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>

        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-primary">
            <Image
              src="/logo_imperatriz.png"
              alt=""
              width={24}
              height={24}
              className="h-full w-full object-contain"
            />
          </span>
          <span className="leading-tight">
            <span className="block truncate text-sm font-semibold">Imperatriz</span>
            <span className="hidden text-[10px] text-muted-foreground sm:block">SRS</span>
          </span>
        </span>

        {/* Desktop (≥ lg): links inline; abaixo disso a gaveta assume. */}
        <div className="hidden min-w-0 flex-1 items-center pl-3 lg:flex">
          <NavLinks items={visibleItems} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Menu do usuário: perfil, alterar senha, configurações (ADMIN) e sair. */}
          <div className="hidden md:flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="max-w-[11rem] gap-1.5"
                  aria-label="Menu do usuário"
                  title="Menu do usuário"
                >
                  <span className="truncate font-medium">{user.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-60">
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

                <DropdownMenuItem
                  disabled={loggingOut}
                  onSelect={() => void handleLogout()}
                >
                  <LogOut aria-hidden />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ChangePasswordDialog
              controlledOpen={passwordOpen}
              onControlledOpenChange={setPasswordOpen}
              showLabel={false}
            />
          </div>
        </div>
      </div>

      {/* Mobile / tablet (< lg): gaveta com links, usuário e ações. */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Menu de navegação">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-primary">
                  <Image
                    src="/logo_imperatriz.png"
                    alt=""
                    width={24}
                    height={24}
                    className="h-full w-full object-contain"
                  />
                </span>
                <span className="text-sm font-semibold">Imperatriz</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar menu"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </div>

            <NavLinks
              items={visibleItems}
              alwaysShowLabels
              onNavigate={() => setOpen(false)}
              className="flex-1 flex-col items-stretch gap-0.5 overflow-y-auto p-2"
            />

            <div className="space-y-1 border-t p-2">
              <div className="rounded border bg-muted/50 px-3 py-2">
                <p className="truncate text-xs font-semibold">{user.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                <Badge variant="secondary" className="mt-1">
                  {ROLE_LABELS[user.role]}
                </Badge>
              </div>

              {can(user.role, "menu.settings") ? (
                <Link
                  href="/configuracoes"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Cog className="h-4 w-4" aria-hidden />
                  Configurações
                </Link>
              ) : null}

              <ChangePasswordDialog
                variant="ghost"
                className="w-full justify-start gap-2 px-3 text-muted-foreground hover:text-foreground"
              />

              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start gap-2 px-3 text-muted-foreground hover:text-foreground"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Sair
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
