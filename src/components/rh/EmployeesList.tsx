"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, RotateCcw, Upload } from "lucide-react";

import type { EmployeeRow } from "@/lib/types/database";
import { Button } from "@/components/ui/button";
import { ListFooter, ListScroll } from "@/components/layout/ListPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DeliveryPeriodPopover,
  FilterMenu,
  TextColumnFilter,
} from "@/components/shared/column-filters";

const PAGE_SIZE = 25;

export interface EmployeeListFilters {
  registration: string;
  name: string;
  company: string;
  status: string;
  location: string;
  shift: string;
  area: string;
  client: string;
  responsible1: string;
  responsible2: string;
  admissionFrom: string | null;
  admissionTo: string | null;
  dismissalFrom: string | null;
  dismissalTo: string | null;
}

type TextFilterField =
  | "registration"
  | "name"
  | "location"
  | "shift"
  | "area"
  | "client"
  | "responsible1"
  | "responsible2";

const EMPTY_FILTERS: EmployeeListFilters = {
  registration: "",
  name: "",
  company: "",
  status: "ALL",
  location: "",
  shift: "",
  area: "",
  client: "",
  responsible1: "",
  responsible2: "",
  admissionFrom: null,
  admissionTo: null,
  dismissalFrom: null,
  dismissalTo: null,
};

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function matchesText(value: string | null | undefined, query: string): boolean {
  return !query || normalizeSearch(value).includes(normalizeSearch(query));
}

function hasActiveFilters(filters: EmployeeListFilters): boolean {
  return (
    filters.registration !== "" ||
    filters.name !== "" ||
    filters.company !== "" ||
    filters.status !== "ALL" ||
    filters.location !== "" ||
    filters.shift !== "" ||
    filters.area !== "" ||
    filters.client !== "" ||
    filters.responsible1 !== "" ||
    filters.responsible2 !== "" ||
    filters.admissionFrom !== null ||
    filters.admissionTo !== null ||
    filters.dismissalFrom !== null ||
    filters.dismissalTo !== null
  );
}

/** Aplica os filtros das colunas à lista já carregada no servidor. */
export function filterEmployees(
  employees: readonly EmployeeRow[],
  filters: EmployeeListFilters,
): EmployeeRow[] {
  return employees.filter((employee) => {
    if (!matchesText(employee.registration, filters.registration)) return false;
    if (!matchesText(employee.name, filters.name)) return false;
    if (filters.company && employee.company_code !== filters.company) return false;
    if (filters.status !== "ALL" && employee.status !== filters.status) return false;
    if (!matchesText(employee.location, filters.location)) return false;
    if (!matchesText(employee.shift, filters.shift)) return false;
    if (!matchesText(employee.area, filters.area)) return false;
    if (!matchesText(employee.client, filters.client)) return false;
    if (!matchesText(employee.responsible_1, filters.responsible1)) return false;
    if (!matchesText(employee.responsible_2, filters.responsible2)) return false;

    const admission = employee.admission_date ?? "";
    if (filters.admissionFrom && (!admission || admission < filters.admissionFrom)) return false;
    if (filters.admissionTo && (!admission || admission > filters.admissionTo)) return false;

    const dismissal = employee.dismissal_date ?? "";
    if (filters.dismissalFrom && (!dismissal || dismissal < filters.dismissalFrom)) return false;
    if (filters.dismissalTo && (!dismissal || dismissal > filters.dismissalTo)) return false;

    return true;
  });
}

/** Rótulo do cabeçalho com o funil de filtro ao lado. */
function HeaderLabel({
  label,
  fullLabel,
  filter,
}: {
  label: string;
  fullLabel?: string;
  filter?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span title={fullLabel}>{label}</span>
      {fullLabel ? <span className="sr-only">{fullLabel}</span> : null}
      {filter}
    </span>
  );
}

export function EmployeesList({ employees, canManage }: { employees: EmployeeRow[]; canManage: boolean }) {
  const [filters, setFilters] = useState<EmployeeListFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterEmployees(employees, filters), [employees, filters]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const companies = [...new Map(employees.map((employee) => [employee.company_code, employee.company_name])).entries()]
    .sort(([codeA], [codeB]) => codeA.localeCompare(codeB, "pt-BR"));

  function apply(overrides: Partial<EmployeeListFilters>) {
    setFilters((current) => ({ ...current, ...overrides }));
    setPage(1);
  }

  function textFilter(field: TextFilterField, column: string, context: string) {
    return (
      <TextColumnFilter
        value={filters[field]}
        column={column}
        context={context}
        onApply={(value) => apply({ [field]: value } as Partial<EmployeeListFilters>)}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-3 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{filtered.length} funcionário(s)</p>
          {hasActiveFilters(filters) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />Limpar filtros
            </Button>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/rh/funcionarios/importacao"><Upload className="h-4 w-4" aria-hidden />Importar</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/rh/funcionarios/novo"><Plus className="h-4 w-4" aria-hidden />Novo funcionário</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <ListScroll>
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-muted">
            <TableRow>
              <TableHead>
                <HeaderLabel label="Matrícula" filter={textFilter("registration", "Matrícula", "matrícula")} />
              </TableHead>
              <TableHead>
                <HeaderLabel label="Nome" filter={textFilter("name", "Nome", "nome")} />
              </TableHead>
              <TableHead>
                <HeaderLabel
                  label="Empresa"
                  filter={
                    <FilterMenu
                      context="empresa"
                      value={filters.company}
                      active={filters.company !== ""}
                      options={[
                        { value: "", label: "Todas as empresas" },
                        ...companies.map(([code, name]) => ({ value: code, label: `${code} — ${name}` })),
                      ]}
                      onValueChange={(value) => apply({ company: value })}
                    />
                  }
                />
              </TableHead>
              <TableHead>
                <HeaderLabel
                  label="Admissão"
                  filter={
                    <DeliveryPeriodPopover
                      context="admissão"
                      idPrefix="funcionarios-admissao"
                      from={filters.admissionFrom}
                      to={filters.admissionTo}
                      active={filters.admissionFrom !== null || filters.admissionTo !== null}
                      onApply={(from, to) => apply({ admissionFrom: from, admissionTo: to })}
                    />
                  }
                />
              </TableHead>
              <TableHead>
                <HeaderLabel
                  label="Demissão"
                  filter={
                    <DeliveryPeriodPopover
                      context="demissão"
                      idPrefix="funcionarios-demissao"
                      from={filters.dismissalFrom}
                      to={filters.dismissalTo}
                      active={filters.dismissalFrom !== null || filters.dismissalTo !== null}
                      onApply={(from, to) => apply({ dismissalFrom: from, dismissalTo: to })}
                    />
                  }
                />
              </TableHead>
              <TableHead>
                <HeaderLabel
                  label="Status"
                  filter={
                    <FilterMenu
                      context="status do funcionário"
                      value={filters.status}
                      active={filters.status !== "ALL"}
                      options={[
                        { value: "ALL", label: "Todos os status" },
                        { value: "ATIVO", label: "Ativo" },
                        { value: "INATIVO", label: "Inativo" },
                      ]}
                      onValueChange={(value) => apply({ status: value })}
                    />
                  }
                />
              </TableHead>
              <TableHead>
                <HeaderLabel label="Local" filter={textFilter("location", "Local", "local")} />
              </TableHead>
              <TableHead>
                <HeaderLabel label="Turno" filter={textFilter("shift", "Turno", "turno")} />
              </TableHead>
              <TableHead>
                <HeaderLabel label="Área" filter={textFilter("area", "Área", "área")} />
              </TableHead>
              <TableHead>
                <HeaderLabel label="Cliente" filter={textFilter("client", "Cliente", "cliente")} />
              </TableHead>
              <TableHead>
                <HeaderLabel label="Lid." fullLabel="Líder" filter={textFilter("responsible1", "Líder", "líder")} />
              </TableHead>
              <TableHead>
                <HeaderLabel
                  label="Enc."
                  fullLabel="Encarregado"
                  filter={textFilter("responsible2", "Encarregado", "encarregado")}
                />
              </TableHead>
              {canManage ? <TableHead className="text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell className="font-medium">{employee.registration}</TableCell>
                <TableCell>{employee.name}</TableCell>
                <TableCell>{employee.company_name}</TableCell>
                <TableCell>{dateLabel(employee.admission_date)}</TableCell>
                <TableCell>{dateLabel(employee.dismissal_date)}</TableCell>
                <TableCell>
                  <span className={`rounded-full px-2 py-1 text-xs ${employee.status === "ATIVO" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}>
                    {employee.status === "ATIVO" ? "Ativo" : "Inativo"}
                  </span>
                </TableCell>
                <TableCell>{employee.location ?? "—"}</TableCell>
                <TableCell>{employee.shift ?? "—"}</TableCell>
                <TableCell>{employee.area ?? "—"}</TableCell>
                <TableCell>{employee.client ?? "—"}</TableCell>
                <TableCell>{employee.responsible_1 ?? "—"}</TableCell>
                <TableCell>{employee.responsible_2 ?? "—"}</TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/rh/funcionarios/${employee.id}/editar`}><Pencil className="h-3.5 w-3.5" aria-hidden />Editar</Link>
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 13 : 12} className="py-8 text-center text-muted-foreground">
                  Nenhum funcionário encontrado para os filtros informados.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </ListScroll>
      <ListFooter className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Página {page} de {pageCount}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
        </div>
      </ListFooter>
    </section>
  );
}
