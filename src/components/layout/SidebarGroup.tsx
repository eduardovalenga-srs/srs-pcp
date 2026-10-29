"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { isItemActive, type NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { SidebarNavItem } from "@/components/layout/SidebarNavItem";

interface SidebarGroupProps {
  group: NavGroup;
  /** Aberto na primeira pintura (rota atual dentro do grupo). */
  defaultOpen: boolean;
  /** Sidebar em modo trilha de ícones. */
  collapsed: boolean;
  /**
   * Sidebar recolhida + clique no grupo: em vez de desdobrar dentro de uma
   * trilha de ícones (sem espaço para rótulos), a sidebar inteira abre e o
   * grupo desdobra junto — o caminho mais curto até o item desejado.
   */
  onExpand?: () => void;
  onNavigate?: () => void;
}

/**
 * Grupo expansível da sidebar (043). O cabeçalho é um `<button>` real com
 * `aria-expanded`/`aria-controls`; os itens ficam numa lista que sai da árvore
 * de acessibilidade quando recolhida.
 *
 * O layout do dashboard NÃO remonta entre navegações, então `defaultOpen`
 * sozinho não basta: o grupo também se abre quando a rota muda para dentro
 * dele. Esse ajuste acontece durante o render (padrão React de estado
 * derivado de prop), e não num efeito — evita render extra e o lint de
 * `setState` em `useEffect`.
 */
export function SidebarGroup({ group, defaultOpen, collapsed, onExpand, onNavigate }: SidebarGroupProps) {
  const pathname = usePathname();
  const containsActive = group.items.some((item) => isItemActive(pathname, item.href));

  const [open, setOpen] = useState(defaultOpen || containsActive);
  const [lastPath, setLastPath] = useState(pathname);
  const contentId = useId();

  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (containsActive) setOpen(true);
  }

  const handleClick = () => {
    if (collapsed) {
      onExpand?.();
      return;
    }
    setOpen((value) => !value);
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={collapsed ? undefined : open}
        aria-controls={contentId}
        aria-label={group.label}
        title={collapsed ? group.label : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground",
          collapsed && "justify-center px-0",
        )}
      >
        <group.icon className="h-4 w-4 shrink-0" aria-hidden />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
              aria-hidden
            />
          </>
        )}
      </button>

      <ul
        id={contentId}
        hidden={collapsed || !open}
        className={cn("mt-0.5 space-y-0.5 border-l pl-2 ml-3.5", collapsed && "border-l-0 ml-0 pl-0")}
      >
        {group.items.map((item) => (
          <li key={item.href}>
            <SidebarNavItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </li>
  );
}
