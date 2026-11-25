"use client";

import { useId } from "react";

import {
  ACCESS_SCREENS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  applyScreenSelection,
  permissionAllowedForAccountType,
  screenSelection,
  type AccessConfig,
  type AccessScreen,
  type AccountType,
  type PermissionKey,
} from "@/lib/auth/access";
import type { ClientRootOption } from "@/lib/repositories/access.repository";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Empresas empregadoras conhecidas (migration 101). */
export const COMPANY_OPTIONS = [
  { code: "750", label: "750 — Serralheria" },
  { code: "752", label: "752 — Filial" },
] as const;

type ScreenState = "none" | "view" | "edit";

interface AccessEditorProps {
  value: AccessConfig;
  onChange: (next: AccessConfig) => void;
  clientRoots: ClientRootOption[];
  disabled?: boolean;
  /** ADMIN tem acesso total e não pode ser limitado. */
  isAdmin?: boolean;
}

function allowedOperations(screen: AccessScreen, accountType: AccountType) {
  return screen.operations.filter((operation) =>
    permissionAllowedForAccountType(operation.key, accountType),
  );
}

function screenAvailable(screen: AccessScreen, accountType: AccountType) {
  return (
    screen.view.some((key) => permissionAllowedForAccountType(key, accountType)) ||
    screen.operations.some((operation) =>
      permissionAllowedForAccountType(operation.key, accountType),
    )
  );
}

function screenState(screen: AccessScreen, permissions: readonly PermissionKey[]): ScreenState {
  const selection = screenSelection(screen, permissions);
  if (!selection.view) return "none";
  return selection.operations.length > 0 ? "edit" : "view";
}

/**
 * Editor de acesso por tela (migration 101).
 *
 * Cada tela oferece Sem acesso / Visualizar / Editar. "Editar" concede
 * todas as operações de escrita permitidas para o tipo de conta. O
 * escopo de dados (empresas para interno, cliente para externo) fica
 * logo abaixo.
 */
export function AccessEditor({
  value,
  onChange,
  clientRoots,
  disabled = false,
  isAdmin = false,
}: AccessEditorProps) {
  const accountTypeId = useId();
  const locked = disabled || isAdmin;

  const update = (patch: Partial<AccessConfig>) => {
    onChange({ ...value, ...patch });
  };

  const changeAccountType = (accountType: AccountType) => {
    const permissions = value.permissions.filter((key) =>
      permissionAllowedForAccountType(key, accountType),
    );
    update({
      accountType,
      permissions,
      clientIds: accountType === "EXTERNAL" ? value.clientIds : [],
      companyCodes: accountType === "INTERNAL" ? value.companyCodes : [],
    });
  };

  const changeScreen = (screen: AccessScreen, state: ScreenState) => {
    const permissions = applyScreenSelection(
      value.permissions,
      screen,
      {
        view: state !== "none",
        operations: state === "edit" ? allowedOperations(screen, value.accountType).map((op) => op.key) : [],
      },
      value.accountType,
    );
    update({ permissions });
  };

  const toggleClient = (clientId: string, checked: boolean) => {
    update({
      clientIds: checked
        ? [...new Set([...value.clientIds, clientId])]
        : value.clientIds.filter((id) => id !== clientId),
    });
  };

  const toggleCompany = (companyCode: string, checked: boolean) => {
    update({
      companyCodes: checked
        ? [...new Set([...value.companyCodes, companyCode])]
        : value.companyCodes.filter((code) => code !== companyCode),
    });
  };

  const menus = new Map<string, AccessScreen[]>();
  for (const screen of ACCESS_SCREENS) {
    if (screen.id === "settings" && !isAdmin) continue;
    if (!screenAvailable(screen, value.accountType)) continue;
    const list = menus.get(screen.menu) ?? [];
    list.push(screen);
    menus.set(screen.menu, list);
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={accountTypeId}>Tipo de conta</Label>
        <Select
          value={value.accountType}
          onValueChange={(next) => changeAccountType(next as AccountType)}
          disabled={locked}
        >
          <SelectTrigger id={accountTypeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {ACCOUNT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin ? (
          <p className="text-xs text-muted-foreground">
            Administradores têm acesso total ao sistema; as escolhas abaixo não se aplicam.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {value.accountType === "EXTERNAL"
              ? "Usuário externo: vê apenas os dados do cliente vinculado, sem acesso aos demais."
              : "Usuário interno: o escopo de empresas abaixo limita os funcionários visíveis."}
          </p>
        )}
      </div>

      {value.accountType === "EXTERNAL" ? (
        <div className="grid gap-2">
          <Label>Clientes vinculados</Label>
          {clientRoots.length === 0 ? (
            <p className="rounded border border-status-warning-bg bg-status-warning-bg px-2 py-1.5 text-xs">
              Nenhum cliente cadastrado na árvore de alocações.
            </p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-auto rounded border px-2 py-2">
              {clientRoots.map((client) => (
                <label key={client.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.clientIds.includes(client.id)}
                    onCheckedChange={(checked) => toggleClient(client.id, checked === true)}
                    disabled={locked}
                  />
                  {client.name}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Obrigatório ao menos um cliente. O usuário externo só enxerga funcionários e
            alocações desses clientes.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label>Empresas visíveis</Label>
          <div className="space-y-1.5 rounded border px-2 py-2">
            {COMPANY_OPTIONS.map((company) => (
              <label key={company.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.companyCodes.includes(company.code)}
                  onCheckedChange={(checked) => toggleCompany(company.code, checked === true)}
                  disabled={locked}
                />
                {company.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Nenhuma marcada = todas as empresas (sem restrição).
          </p>
        </div>
      )}

      <div className="grid gap-2">
        <Label>Acesso por tela</Label>
        <div className="space-y-3">
          {[...menus.entries()].map(([menu, screens]) => (
            <div key={menu} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {menu}
              </p>
              {screens.map((screen) => {
                const state = screenState(screen, value.permissions);
                const canEdit = allowedOperations(screen, value.accountType).length > 0;
                return (
                  <div
                    key={screen.id}
                    className="flex flex-col gap-1 rounded border px-2 py-1.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">{screen.label}</p>
                      <p className="text-xs text-muted-foreground">{screen.description}</p>
                    </div>
                    <Select
                      value={state}
                      onValueChange={(next) => changeScreen(screen, next as ScreenState)}
                      disabled={locked}
                    >
                      <SelectTrigger
                        className="h-8 w-full text-sm sm:w-[160px]"
                        aria-label={`Acesso a ${screen.label}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem acesso</SelectItem>
                        <SelectItem value="view">Visualizar</SelectItem>
                        <SelectItem value="edit" disabled={!canEdit}>
                          Editar
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
