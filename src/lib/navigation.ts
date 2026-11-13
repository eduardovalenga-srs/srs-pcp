import {
  Boxes,
  ClipboardList,
  Factory,
  LayoutDashboard,
  PackageCheck,
  Truck,
  UserRound,
  Users,
  Warehouse,
  Workflow,
} from "lucide-react";

import { can, type Capability } from "@/lib/auth/permissions";
import type { Role } from "@/lib/constants/orders";

/** Ícone de navegação. */
export type NavIcon = typeof Factory;

/**
 * Item de primeiro nível — uma rota direta, sem sub itens.
 */
export interface NavItem {
  type: "item";
  href: string;
  label: string;
  icon: NavIcon;
  /** Capacidade de menu ausente = sempre visível. */
  capability?: Capability;
}

/**
 * Grupo expansível da sidebar (043). Uma capability no GRUPO esconde o bloco
 * inteiro; sem ela, o grupo aparece conforme os itens visíveis.
 */
export interface NavGroup {
  type: "group";
  /** Chave estável — usada no `aria-controls` e no estado expandido. */
  id: string;
  label: string;
  icon: NavIcon;
  capability?: Capability;
  items: NavEntry[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return entry.type === "group";
}

/**
 * Árvore de navegação (043) — fonte única da sidebar.
 *
 * NOVOS MÓDULOS (RH, almoxarifado, …): acrescente um `NavGroup` aqui e, se
 * precisar, as capabilities em `permissions.ts`. Nenhum componente muda.
 *
 * Agrupamento de produto: "Gestão de Fábrica" concentra o dia a dia fabril.
 * Os cadastros ficam agrupados num submenu próprio; módulos que não são
 * fabricação nascem em grupos próprios (RH).
 */
export const NAV_ENTRIES: NavEntry[] = [
  {
    type: "item",
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    capability: "menu.dashboard",
  },
  {
    type: "group",
    id: "fabrica",
    label: "Gestão de Fábrica",
    icon: Factory,
    items: [
      {
        type: "item",
        href: "/gestao-entregas",
        label: "Gestão de OF",
        icon: ClipboardList,
        capability: "menu.gestao",
      },
      { type: "item", href: "/fabrica-2", label: "Fábrica 2", icon: Warehouse, capability: "menu.fabrica2" },
      { type: "item", href: "/fabrica-1", label: "Fábrica 1", icon: Boxes, capability: "menu.fabrica1" },
      { type: "item", href: "/romaneio", label: "Romaneio", icon: Truck, capability: "menu.romaneio" },
      // 056/057: recebimento de MP (kg por item filho, com o pai sem
      // filhos como fallback) — a coluna MP das listas é o espelho
      // deste fluxo (pai = agregado dos filhos).
      {
        type: "item",
        href: "/recebimento-mp",
        label: "Recebimento MP",
        icon: PackageCheck,
        capability: "menu.recebimento_mp",
      },
      {
        type: "group",
        id: "cadastros",
        label: "Cadastros",
        icon: ClipboardList,
        items: [
          {
            type: "item",
            href: "/processos",
            label: "Processos",
            icon: Workflow,
            capability: "menu.processes",
          },
          {
            type: "item",
            href: "/grupos-produtos",
            label: "Grupos de produtos",
            icon: Boxes,
            capability: "menu.product_groups",
          },
        ],
      },
    ],
  },
  {
    type: "group",
    id: "rh",
    label: "RH",
    icon: Users,
    capability: "menu.rh",
    items: [
      {
        type: "item",
        href: "/rh/funcionarios",
        label: "Funcionários",
        icon: UserRound,
        capability: "rh.view",
      },
    ],
  },
];

/**
 * Entradas visíveis para o papel.
 *
 * Regras: o item some sem a sua capability; o GRUPO some quando a sua
 * capability nega (ex.: RH para OPERADOR_F2) ou quando nenhum item sobra —
 * assim um módulo sem permissão nunca deixa um grupo vazio na tela.
 */
export function visibleEntries(role: Role | null | undefined): NavEntry[] {
  const filterEntries = (source: readonly NavEntry[]): NavEntry[] => {
    const entries: NavEntry[] = [];
    for (const entry of source) {
      if (entry.type === "item") {
        if (!entry.capability || can(role, entry.capability)) entries.push(entry);
        continue;
      }
      if (entry.capability && !can(role, entry.capability)) continue;
      const items = filterEntries(entry.items);
      if (items.length === 0) continue;
      entries.push({ ...entry, items });
    }
    return entries;
  };
  return filterEntries(NAV_ENTRIES);
}

/**
 * Rota atual casa com o item? prefixo com "/" final — "/fabrica-1" não pode
 * casar com "/fabrica-10".
 */
export function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Um item ou grupo contém a rota atual? */
export function navEntryContainsPath(entry: NavEntry, pathname: string): boolean {
  if (entry.type === "item") return isItemActive(pathname, entry.href);
  return entry.items.some((item) => navEntryContainsPath(item, pathname));
}

/** Grupos ancestrais da rota atual (usados para abrir os submenus necessários). */
export function activeGroupIds(pathname: string, entries: readonly NavEntry[]): string[] {
  const activeIds: string[] = [];
  const visit = (items: readonly NavEntry[]) => {
    for (const entry of items) {
      if (!isNavGroup(entry) || !navEntryContainsPath(entry, pathname)) continue;
      activeIds.push(entry.id);
      visit(entry.items);
    }
  };
  visit(entries);
  return activeIds;
}
