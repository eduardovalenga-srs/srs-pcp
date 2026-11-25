import { capabilitiesFor, type Capability } from "@/lib/auth/permissions";
import type { Role } from "@/lib/constants/orders";

/**
 * Catálogo de acessos personalizados (migration 101).
 *
 * O papel (`profiles.role`) continua existindo como perfil-modelo legado.
 * A autorização efetiva usa as permissões abaixo, resolvidas por
 * perfil-modelo + overrides individuais e limitadas pelo tipo de conta.
 */

export const ACCOUNT_TYPES = ["INTERNAL", "EXTERNAL"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  INTERNAL: "Usuário interno",
  EXTERNAL: "Usuário externo (cliente)",
};

/** Operações granulares de RH (não existiam como capabilities). */
export type RhPermissionKey =
  | "rh.employees.view"
  | "rh.employees.create"
  | "rh.employees.edit"
  | "rh.employees.import"
  | "rh.allocations.view"
  | "rh.allocations.create_client"
  | "rh.allocations.create_location"
  | "rh.allocations.create_shift"
  | "rh.allocations.create_area"
  | "rh.allocations.create_position"
  | "rh.allocations.edit"
  | "rh.allocations.deactivate"
  | "rh.allocations.delete"
  | "rh.allocations.assign";

export type PermissionKey = Capability | RhPermissionKey;

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  /** Tipos de conta que podem receber a permissão. */
  accountTypes: readonly AccountType[];
}

const INTERNAL_ONLY: readonly AccountType[] = ["INTERNAL"];
const EVERYONE: readonly AccountType[] = ["INTERNAL", "EXTERNAL"];

/**
 * Permissões exclusivas do escopo externo nesta primeira entrega:
 * consultar funcionários/alocações e criar níveis da própria operação.
 */
export const EXTERNAL_PERMISSION_KEYS: readonly PermissionKey[] = [
  "rh.employees.view",
  "rh.allocations.view",
  "rh.allocations.create_location",
  "rh.allocations.create_shift",
  "rh.allocations.create_area",
  "rh.allocations.create_position",
  "rh.recruitment.view",
];

const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  // Produção / pedidos
  { key: "production.view", label: "Produção — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "production.edit", label: "Produção — editar", accountTypes: INTERNAL_ONLY },
  { key: "production.update_status", label: "Produção — atualizar status", accountTypes: INTERNAL_ONLY },
  { key: "production.view_history", label: "Produção — ver histórico", accountTypes: INTERNAL_ONLY },
  { key: "orders.view", label: "Pedidos — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "orders.create", label: "Pedidos — criar", accountTypes: INTERNAL_ONLY },
  { key: "orders.edit", label: "Pedidos — editar", accountTypes: INTERNAL_ONLY },
  { key: "orders.delete", label: "Pedidos — excluir", accountTypes: INTERNAL_ONLY },
  { key: "dashboard.view", label: "Dashboard — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "import.access", label: "Importação de OF", accountTypes: INTERNAL_ONLY },
  { key: "processes.view", label: "Processos — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "processes.manage", label: "Processos — gerenciar", accountTypes: INTERNAL_ONLY },
  { key: "settings.manage", label: "Configurações — acessar", accountTypes: INTERNAL_ONLY },
  { key: "users.manage", label: "Usuários — gerenciar", accountTypes: INTERNAL_ONLY },
  { key: "romaneio.view", label: "Romaneio — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "romaneio.edit", label: "Romaneio — editar", accountTypes: INTERNAL_ONLY },
  { key: "menu.gestao", label: "Menu: Gestão de OF", accountTypes: INTERNAL_ONLY },
  { key: "menu.dashboard", label: "Menu: Dashboard", accountTypes: INTERNAL_ONLY },
  { key: "menu.processes", label: "Menu: Processos", accountTypes: INTERNAL_ONLY },
  { key: "menu.product_groups", label: "Menu: Grupos de produtos", accountTypes: INTERNAL_ONLY },
  { key: "menu.fabrica1", label: "Menu: Fábrica 1", accountTypes: INTERNAL_ONLY },
  { key: "fabrica2.view", label: "Fábrica 2 — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "menu.fabrica2", label: "Menu: Fábrica 2", accountTypes: INTERNAL_ONLY },
  { key: "menu.settings", label: "Menu: Configurações", accountTypes: INTERNAL_ONLY },
  { key: "menu.romaneio", label: "Menu: Romaneio", accountTypes: INTERNAL_ONLY },
  { key: "menu.recebimento_mp", label: "Menu: Recebimento MP", accountTypes: INTERNAL_ONLY },
  { key: "mp_receipt.edit", label: "Recebimento MP — editar", accountTypes: INTERNAL_ONLY },
  { key: "menu.sequenciamento", label: "Menu: Sequenciamento", accountTypes: INTERNAL_ONLY },
  // RH — funcionários
  { key: "rh.employees.view", label: "Funcionários — visualizar", accountTypes: EVERYONE },
  { key: "rh.employees.create", label: "Funcionários — cadastrar", accountTypes: INTERNAL_ONLY },
  { key: "rh.employees.edit", label: "Funcionários — editar", accountTypes: INTERNAL_ONLY },
  { key: "rh.employees.import", label: "Funcionários — importar", accountTypes: INTERNAL_ONLY },
  // RH — alocações
  { key: "rh.allocations.view", label: "Alocações — visualizar", accountTypes: EVERYONE },
  { key: "rh.allocations.create_client", label: "Alocações — criar cliente", accountTypes: INTERNAL_ONLY },
  { key: "rh.allocations.create_location", label: "Alocações — criar local", accountTypes: EVERYONE },
  { key: "rh.allocations.create_shift", label: "Alocações — criar turno", accountTypes: EVERYONE },
  { key: "rh.allocations.create_area", label: "Alocações — criar área", accountTypes: EVERYONE },
  { key: "rh.allocations.create_position", label: "Alocações — criar posição", accountTypes: EVERYONE },
  { key: "rh.allocations.edit", label: "Alocações — editar itens", accountTypes: INTERNAL_ONLY },
  { key: "rh.allocations.deactivate", label: "Alocações — inativar/reativar", accountTypes: INTERNAL_ONLY },
  { key: "rh.allocations.delete", label: "Alocações — excluir estrutura", accountTypes: INTERNAL_ONLY },
  { key: "rh.allocations.assign", label: "Alocações — alocar/transferir funcionário", accountTypes: INTERNAL_ONLY },
  // RH — recrutamento
  { key: "rh.recruitment.view", label: "Vagas — visualizar", accountTypes: EVERYONE },
  { key: "rh.recruitment.manage", label: "Vagas/cargos — gerenciar", accountTypes: INTERNAL_ONLY },
  // RH — legado (mantido para compatibilidade das telas antigas)
  { key: "menu.rh", label: "Menu: RH", accountTypes: INTERNAL_ONLY },
  { key: "rh.view", label: "RH (legado) — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "rh.manage", label: "RH (legado) — gerenciar", accountTypes: INTERNAL_ONLY },
  { key: "rh.allocation.view", label: "Alocações (legado) — visualizar", accountTypes: INTERNAL_ONLY },
  { key: "rh.allocation.manage", label: "Alocações (legado) — gerenciar", accountTypes: INTERNAL_ONLY },
];

export const PERMISSIONS: Record<PermissionKey, PermissionDefinition> = Object.fromEntries(
  PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition]),
) as Record<PermissionKey, PermissionDefinition>;

export const ALL_PERMISSION_KEYS = PERMISSION_DEFINITIONS.map(
  (definition) => definition.key,
) as readonly PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function permissionAllowedForAccountType(
  key: PermissionKey,
  accountType: AccountType,
): boolean {
  return PERMISSIONS[key]?.accountTypes.includes(accountType) ?? false;
}

// ------------------------------------------------------------------
// Telas do editor de permissões
// ------------------------------------------------------------------

export interface AccessOperation {
  key: PermissionKey;
  label: string;
}

export interface AccessScreen {
  id: string;
  menu: string;
  label: string;
  description: string;
  /** Permissões necessárias para a tela/menu aparecer. */
  view: readonly PermissionKey[];
  /** Operações de escrita configuráveis. */
  operations: readonly AccessOperation[];
}

export const ACCESS_SCREENS: readonly AccessScreen[] = [
  {
    id: "dashboard",
    menu: "Dashboard",
    label: "Dashboard",
    description: "Indicadores gerais da fábrica.",
    view: ["menu.dashboard", "dashboard.view"],
    operations: [],
  },
  {
    id: "gestao",
    menu: "Gestão de Fábrica",
    label: "Gestão de OF",
    description: "Pedidos, itens, prazos e entregas.",
    view: ["menu.gestao", "production.view", "orders.view"],
    operations: [
      { key: "orders.create", label: "Criar pedidos" },
      { key: "orders.edit", label: "Editar pedidos" },
      { key: "orders.delete", label: "Excluir pedidos" },
      { key: "production.edit", label: "Editar produção" },
      { key: "production.update_status", label: "Atualizar status" },
      { key: "production.view_history", label: "Ver histórico" },
    ],
  },
  {
    id: "fabrica1",
    menu: "Gestão de Fábrica",
    label: "Fábrica 1",
    description: "Itens filhos, materiais e processos.",
    view: ["menu.fabrica1"],
    operations: [
      { key: "production.edit", label: "Editar produção" },
      { key: "production.update_status", label: "Atualizar status" },
    ],
  },
  {
    id: "fabrica2",
    menu: "Gestão de Fábrica",
    label: "Fábrica 2",
    description: "Réplica da gestão fabril na Fábrica 2.",
    view: ["menu.fabrica2", "fabrica2.view"],
    operations: [{ key: "production.update_status", label: "Atualizar status" }],
  },
  {
    id: "romaneio",
    menu: "Gestão de Fábrica",
    label: "Romaneio",
    description: "Expedição e conferência de carga.",
    view: ["menu.romaneio", "romaneio.view"],
    operations: [{ key: "romaneio.edit", label: "Criar/editar romaneio" }],
  },
  {
    id: "recebimento",
    menu: "Gestão de Fábrica",
    label: "Recebimento MP",
    description: "Recebimento de matéria-prima.",
    view: ["menu.recebimento_mp"],
    operations: [{ key: "mp_receipt.edit", label: "Registrar recebimento" }],
  },
  {
    id: "sequenciamento",
    menu: "Gestão de Fábrica",
    label: "Sequenciamento",
    description: "Fila de produção por processo.",
    view: ["menu.sequenciamento"],
    operations: [{ key: "production.edit", label: "Gravar sequenciamento" }],
  },
  {
    id: "processos",
    menu: "Cadastros",
    label: "Processos",
    description: "Catálogo de processos fabris.",
    view: ["menu.processes", "processes.view"],
    operations: [{ key: "processes.manage", label: "Cadastrar/editar processos" }],
  },
  {
    id: "grupos",
    menu: "Cadastros",
    label: "Grupos de produtos",
    description: "Grupos, itens e capacidades.",
    view: ["menu.product_groups"],
    operations: [],
  },
  {
    id: "importacao",
    menu: "Gestão de Fábrica",
    label: "Importação de OF",
    description: "Importar planilhas/PDF de ordens.",
    view: ["import.access"],
    operations: [],
  },
  {
    id: "employees",
    menu: "RH",
    label: "Funcionários",
    description: "Lista e cadastro de funcionários.",
    view: ["menu.rh", "rh.employees.view"],
    operations: [
      { key: "rh.employees.create", label: "Cadastrar funcionário" },
      { key: "rh.employees.edit", label: "Editar funcionário" },
      { key: "rh.employees.import", label: "Importar funcionários" },
    ],
  },
  {
    id: "allocations",
    menu: "RH",
    label: "Alocações",
    description: "Árvore cliente → local → turno → área → posição.",
    view: ["menu.rh", "rh.allocations.view"],
    operations: [
      { key: "rh.allocations.create_client", label: "Criar cliente" },
      { key: "rh.allocations.create_location", label: "Criar local" },
      { key: "rh.allocations.create_shift", label: "Criar turno" },
      { key: "rh.allocations.create_area", label: "Criar área" },
      { key: "rh.allocations.create_position", label: "Criar posição" },
      { key: "rh.allocations.edit", label: "Editar itens" },
      { key: "rh.allocations.deactivate", label: "Inativar/reativar" },
      { key: "rh.allocations.delete", label: "Excluir estrutura" },
      { key: "rh.allocations.assign", label: "Alocar/transferir funcionário" },
    ],
  },
  {
    id: "vacancies",
    menu: "RH",
    label: "Vagas",
    description: "Vagas e candidatos do recrutamento.",
    view: ["menu.rh", "rh.recruitment.view"],
    operations: [{ key: "rh.recruitment.manage", label: "Gerenciar vagas" }],
  },
  {
    id: "approved_roles",
    menu: "RH",
    label: "Cargos aprovados",
    description: "Cargos por cliente usados nas vagas.",
    view: ["menu.rh", "rh.recruitment.view"],
    operations: [{ key: "rh.recruitment.manage", label: "Gerenciar cargos aprovados" }],
  },
  {
    id: "settings",
    menu: "Configurações",
    label: "Usuários e configurações",
    description: "Cadastro de usuários e catálogos do sistema.",
    view: ["settings.manage"],
    operations: [{ key: "users.manage", label: "Gerenciar usuários" }],
  },
];

export function screenKeys(screen: AccessScreen): PermissionKey[] {
  return [...screen.view, ...screen.operations.map((operation) => operation.key)];
}

export interface ScreenSelection {
  view: boolean;
  operations: PermissionKey[];
}

export function screenSelection(
  screen: AccessScreen,
  permissions: readonly string[],
): ScreenSelection {
  const granted = new Set(permissions);
  return {
    view: screen.view.some((key) => granted.has(key)),
    operations: screen.operations
      .filter((operation) => granted.has(operation.key))
      .map((operation) => operation.key),
  };
}

/** Aplica a seleção de uma tela mantendo as permissões das outras telas. */
export function applyScreenSelection(
  permissions: readonly string[],
  screen: AccessScreen,
  selection: ScreenSelection,
  accountType: AccountType,
): PermissionKey[] {
  const managed = new Set(screenKeys(screen));
  const next = new Set<PermissionKey>();
  for (const key of permissions) {
    if (!isPermissionKey(key)) continue;
    if (managed.has(key)) continue;
    if (!permissionAllowedForAccountType(key, accountType)) continue;
    next.add(key);
  }

  if (selection.view) {
    for (const key of screen.view) {
      if (permissionAllowedForAccountType(key, accountType)) next.add(key);
    }
  }
  for (const key of selection.operations) {
    if (
      managed.has(key) &&
      permissionAllowedForAccountType(key, accountType) &&
      screen.operations.some((operation) => operation.key === key)
    ) {
      next.add(key);
    }
  }
  return [...next];
}

// ------------------------------------------------------------------
// Contexto resolvido por sessão
// ------------------------------------------------------------------

export interface AccessContext {
  accountType: AccountType;
  permissions: PermissionKey[];
  /** Empresas visíveis para usuários internos. */
  companyCodes: string[];
  /** Clientes (raízes CLIENT) visíveis para usuários externos. */
  clientIds: string[];
}

export const EMPTY_ACCESS: AccessContext = {
  accountType: "INTERNAL",
  permissions: [],
  companyCodes: [],
  clientIds: [],
};

export function hasPermission(
  access: { permissions: readonly PermissionKey[] } | null | undefined,
  key: PermissionKey,
): boolean {
  return access?.permissions.includes(key) ?? false;
}

export function isExternalAccess(
  access: Pick<AccessContext, "accountType"> | null | undefined,
): boolean {
  return access?.accountType === "EXTERNAL";
}

/**
 * Permissões padrão por papel legado. Mantém o comportamento atual e serve
 * de fallback quando o contexto do banco não está disponível.
 */
export function roleDefaultPermissions(role: Role | null | undefined): PermissionKey[] {
  if (!role) return [];
  if (role === "ADMIN") return [...ALL_PERMISSION_KEYS];

  const legacy = new Set<Capability>(capabilitiesFor(role));
  const permissions = new Set<PermissionKey>(legacy);

  if (legacy.has("rh.view")) permissions.add("rh.employees.view");
  if (legacy.has("rh.manage")) {
    permissions.add("rh.employees.create");
    permissions.add("rh.employees.edit");
    permissions.add("rh.employees.import");
  }
  if (legacy.has("rh.allocation.view")) permissions.add("rh.allocations.view");
  if (legacy.has("rh.allocation.manage")) {
    permissions.add("rh.allocations.create_client");
    permissions.add("rh.allocations.create_location");
    permissions.add("rh.allocations.create_shift");
    permissions.add("rh.allocations.create_area");
    permissions.add("rh.allocations.create_position");
    permissions.add("rh.allocations.edit");
    permissions.add("rh.allocations.deactivate");
    permissions.add("rh.allocations.delete");
    permissions.add("rh.allocations.assign");
  }
  return [...permissions];
}

/** Configuração inicial de acesso derivada do papel (perfil-modelo). */
export function defaultAccessConfig(
  role: Role | null | undefined,
  accountType: AccountType = "INTERNAL",
): AccessConfig {
  return {
    accountType,
    accessProfileId: null,
    permissions: roleDefaultPermissions(role).filter((key) =>
      permissionAllowedForAccountType(key, accountType),
    ),
    clientIds: [],
    companyCodes: [],
  };
}

/** Primeira rota coerente com o acesso (externo cai no RH). */
export function homePathForAccess(
  access: Pick<AccessContext, "accountType" | "permissions"> | null | undefined,
  role: Role | null | undefined,
): string {
  if (access?.accountType === "EXTERNAL") {
    return hasPermission(access, "rh.employees.view") ? "/rh/funcionarios" : "/rh/alocacoes";
  }
  const permissions = access?.permissions;
  if (permissions) {
    if (!permissions.includes("production.view") && permissions.includes("fabrica2.view")) {
      return "/fabrica-2";
    }
    if (!permissions.includes("production.view") && permissions.includes("menu.fabrica1")) {
      return "/fabrica-1";
    }
  }
  // Fallback legado.
  if (role && !roleDefaultPermissions(role).includes("production.view")) {
    return role === "OPERADOR_F2" ? "/fabrica-2" : "/fabrica-1";
  }
  return "/gestao-entregas";
}

// ------------------------------------------------------------------
// Validação da configuração salva pelo ADMIN
// ------------------------------------------------------------------

export interface AccessConfig {
  accountType: AccountType;
  accessProfileId: string | null;
  permissions: PermissionKey[];
  clientIds: string[];
  companyCodes: string[];
}

export type AccessConfigValidation =
  | { ok: true; value: AccessConfig }
  | { ok: false; message: string };

export function normalizeAccessConfig(input: {
  accountType?: string | null;
  accessProfileId?: string | null;
  permissions?: readonly string[] | null;
  clientIds?: readonly string[] | null;
  companyCodes?: readonly string[] | null;
}): AccessConfigValidation {
  const accountType = (input.accountType ?? "INTERNAL") as AccountType;
  if (!ACCOUNT_TYPES.includes(accountType)) {
    return { ok: false, message: "Tipo de conta inválido." };
  }

  const permissions: PermissionKey[] = [];
  for (const raw of input.permissions ?? []) {
    if (!isPermissionKey(raw)) {
      return { ok: false, message: `Permissão desconhecida: ${raw}.` };
    }
    if (!permissionAllowedForAccountType(raw, accountType)) {
      return {
        ok: false,
        message: `A permissão "${PERMISSIONS[raw].label}" não está disponível para este tipo de conta.`,
      };
    }
    if (!permissions.includes(raw)) permissions.push(raw);
  }

  const clientIds = [...new Set((input.clientIds ?? []).filter(Boolean))];
  const companyCodes = [...new Set((input.companyCodes ?? []).filter(Boolean))];

  if (accountType === "EXTERNAL") {
    if (clientIds.length === 0) {
      return { ok: false, message: "Selecione ao menos um cliente para o usuário externo." };
    }
    if (companyCodes.length > 0) {
      return { ok: false, message: "Usuário externo não possui escopo por empresa empregadora." };
    }
  }

  if (accountType === "EXTERNAL" && permissions.length === 0) {
    return { ok: false, message: "Conceda ao menos a visualização de funcionários ou alocações." };
  }

  return {
    ok: true,
    value: {
      accountType,
      accessProfileId: input.accessProfileId || null,
      permissions,
      clientIds,
      companyCodes,
    },
  };
}
