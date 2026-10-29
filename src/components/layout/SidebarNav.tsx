"use client";

import { activeGroupIds, isNavGroup, visibleEntries, type NavEntry } from "@/lib/navigation";
import { SidebarGroup } from "@/components/layout/SidebarGroup";
import { SidebarNavItem } from "@/components/layout/SidebarNavItem";

interface SidebarNavProps {
  role: Parameters<typeof visibleEntries>[0];
  /** Rota atual — define que grupo nasce aberto. */
  pathname: string;
  /** Sidebar em modo trilha de ícones (só no desktop recolhido). */
  collapsed?: boolean;
  /** Sidebar recolhida + clique num grupo → abre a sidebar e o grupo. */
  onExpand?: () => void;
  /** Fecha o drawer mobile ao navegar (no desktop não há efeito). */
  onNavigate?: () => void;
}

/**
 * Árvore de navegação (043): entradas filtradas pelo papel, com o grupo da
 * rota atual aberto na primeira pintura.
 *
 * Compartilhada pela sidebar fixa (desktop) e pelo drawer mobile — mesmo
 * modelo, mesma filtragem de capabilities, mesmos rótulos.
 */
export function SidebarNav({ role, pathname, collapsed = false, onExpand, onNavigate }: SidebarNavProps) {
  const entries: NavEntry[] = visibleEntries(role);
  const openIds = activeGroupIds(pathname, entries);

  return (
    <ul className="space-y-1">
      {entries.map((entry) =>
        isNavGroup(entry) ? (
          <SidebarGroup
            key={entry.id}
            group={entry}
            defaultOpen={openIds.includes(entry.id)}
            collapsed={collapsed}
            onExpand={onExpand}
            onNavigate={onNavigate}
          />
        ) : (
          <li key={entry.href}>
            <SidebarNavItem item={entry} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        ),
      )}
    </ul>
  );
}
