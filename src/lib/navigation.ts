import {
  Boxes,
  ClipboardList,
  Factory,
  LayoutDashboard,
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
  items: NavItem[];
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
 * Agrupamento de produto: "Gestão de Fábrica" concentra o dia a dia fabril
 * (gestão de OF, as duas fábricas, romaneio e processos); módulos que não são
 * fabricação nascem em grupos próprios (RH). O Dashboard é entrada de primeiro
 * nível — fora do menu de gestão de OF.
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
      { type: "item", href: "/fabrica-1", label: "Fábrica 1", icon: Boxes, capability: "menu.fabrica1" },
      { type: "item", href: "/fabrica-2", label: "Fábrica 2", icon: Warehouse, capability: "menu.fabrica2" },
      { type: "item", href: "/romaneio", label: "Romaneio", icon: Truck, capability: "menu.romaneio" },
      { type: "item", href: "/processos", label: "Processos", icon: Workflow, capability: "menu.processes" },
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
 * capability nega (ex.: RH para OPERADOR) ou quando nenhum item sobra —
 * assim um módulo sem permissão nunca deixa um grupo vazio na tela.
 */
export function visibleEntries(role: Role | null | undefined): NavEntry[] {
  const entries: NavEntry[] = [];

  for (const entry of NAV_ENTRIES) {
    if (entry.type === "item") {
      if (!entry.capability || can(role, entry.capability)) entries.push(entry);
      continue;
    }
    if (entry.capability && !can(role, entry.capability)) continue;
    const items = entry.items.filter((item) => !item.capability || can(role, item.capability));
    if (items.length === 0) continue;
    entries.push({ ...entry, items });
  }

  return entries;
}

/**
 * Rota atual casa com o item? prefixo com "/" final — "/fabrica-1" não pode
 * casar com "/fabrica-10".
 */
export function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Grupos que contêm a rota atual (usados para abrir o grupo na navegação). */
export function activeGroupIds(pathname: string, entries: readonly NavEntry[]): string[] {
  return entries
    .filter(isNavGroup)
    .filter((group) => group.items.some((item) => isItemActive(pathname, item.href)))
    .map((group) => group.id);
}
