"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isItemActive, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface SidebarNavItemProps {
  item: NavItem;
  /** Modo trilha de ícones (sidebar recolhida) — rótulo vira tooltip nativo. */
  collapsed: boolean;
  onNavigate?: () => void;
}

/**
 * Link de primeiro nível da sidebar (043). A página atual ganha
 * `aria-current="page"`; no modo recolhido o rótulo sai da tela e vira
 * `title` (mesmo padrão de tooltip do resto do sistema).
 */
export function SidebarNavItem({ item, collapsed, onNavigate }: SidebarNavItemProps) {
  const pathname = usePathname();
  const active = isItemActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}
