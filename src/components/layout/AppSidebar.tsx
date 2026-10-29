"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { setSidebarCollapsed, sidebarCollapsedStore } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { UserMenu, type MenuUser } from "@/components/layout/UserMenu";

const WIDTH = { open: "w-60", collapsed: "w-16" } as const;

interface AppSidebarProps {
  user: MenuUser;
}

/**
 * Barra lateral fixa do desktop (043) — substitui o menu que ficava no topo.
 *
 * Recolhe para uma trilha de ícones (`w-16`) e guarda a preferência em
 * `localStorage` via `sidebar-store` (`useSyncExternalStore`): o servidor
 * sempre pinta expandido e o cliente corrige na primeira pintura, sem
 * divergência de hidratação nem flash.
 */
export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    sidebarCollapsedStore.subscribe,
    sidebarCollapsedStore.getSnapshot,
    sidebarCollapsedStore.getServerSnapshot,
  );

  const toggle = () => setSidebarCollapsed(!collapsed);

  /** Sidebar recolhida + grupo → abre a barra e desdobra o grupo clicado. */
  const expand = () => setSidebarCollapsed(false);

  return (
    <aside
      aria-label="Menu lateral"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-card lg:flex",
        collapsed ? WIDTH.collapsed : WIDTH.open,
      )}
    >
      <div className={cn("flex items-center gap-2 border-b py-2.5", collapsed ? "justify-center px-2" : "px-3")}>
        <Link
          href="/"
          aria-label="Ir para a página inicial"
          title={collapsed ? "Imperatriz SRS" : undefined}
          className={cn("flex min-w-0 items-center gap-2", collapsed && "justify-center")}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-primary">
            <Image
              src="/logo_imperatriz.png"
              alt=""
              width={24}
              height={24}
              className="h-full w-full object-contain"
            />
          </span>
          {collapsed ? null : (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">Imperatriz</span>
              <span className="block text-[10px] text-muted-foreground">SRS</span>
            </span>
          )}
        </Link>

        {collapsed ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0"
            onClick={toggle}
            aria-label="Recolher menu"
            title="Recolher menu"
          >
            <PanelLeftClose aria-hidden />
          </Button>
        )}
      </div>

      <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto p-2">
        <SidebarNav role={user.role} pathname={pathname} collapsed={collapsed} onExpand={expand} />
      </nav>

      {/* Rodapé: expandir (só na trilha de ícones) + menu do usuário. */}
      <div className="flex items-center gap-1 border-t p-2">
        {collapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Expandir menu"
            title="Expandir menu"
          >
            <PanelLeftOpen aria-hidden />
          </Button>
        ) : null}

        <UserMenu user={user} showLabel={!collapsed} className={collapsed ? "flex-1" : "w-full"} />
      </div>
    </aside>
  );
}
