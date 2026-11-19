"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Plus, RotateCcw, Upload } from "lucide-react";

import type { EmployeeRow } from "@/lib/types/database";
import {
  DEFAULT_EMPLOYEE_FILTERS,
  filterEmployees,
  sortEmployees,
  type EmployeeListFilters,
  type EmployeeSortKey,
  type EmployeeSortState,
} from "@/lib/utils/employee-list";
import { Button } from "@/components/ui/button";
import { ListFooter, ListScroll } from "@/components/layout/ListPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton } from "@/components/shared/ExportButton";
import {
  DeliveryPeriodPopover,
  FilterMenu,
  TextColumnFilter,
} from "@/components/shared/column-filters";

const PAGE_SIZE = 25;

export { filterEmployees } from "@/lib/utils/employee-list";
export type { EmployeeListFilters } from "@/lib/utils/employee-list";

type TextFilterField =
  | "registration"
  | "name"
  | "location"
  | "shift"
  | "area"
  | "client"
  | "responsible1"
  | "responsible2";

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function hasActiveFilters(filters: EmployeeListFilters): boolean {
  return (
    filters.registration !== "" ||
    filters.name !== "" ||
    filters.company !== "" ||
    filters.status !== "ATIVO" ||
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

/** Rótulo do cabeçalho com o funil de filtro ao lado. */
function HeaderLabel({
  filter,
  sort,
}: {
  filter?: ReactNode;
  sort: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {sort}
      {filter}
    </span>
  );
}

function ariaSort(
  sort: EmployeeSortState,
  key: EmployeeSortKey,
): "ascending" | "descending" | undefined {
  if (sort.key !== key) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function EmployeesList({ employees, canManage }: { employees: EmployeeRow[]; canManage: boolean }) {
  const [filters, setFilters] = useState<EmployeeListFilters>(DEFAULT_EMPLOYEE_FILTERS);
  const [sort, setSort] = useState<EmployeeSortState>({ key: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterEmployees(employees, filters), [employees, filters]);
  const sorted = useMemo(() => sortEmployees(filtered, sort), [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const companies = [...new Map(employees.map((employee) => [employee.company_code, employee.company_name])).entries()]
    .sort(([codeA], [codeB]) => codeA.localeCompare(codeB, "pt-BR"));

  function apply(overrides: Partial<EmployeeListFilters>) {
    setFilters((current) => ({ ...current, ...overrides }));
    setPage(1);
  }

  function sortHeader(key: EmployeeSortKey, label: string, fullLabel = label) {
    const active = sort.key === key;
    const Icon = active
      ? sort.direction === "asc" ? ArrowUp : ArrowDown
      : ArrowUpDown;

    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:text-foreground"
        aria-label={`Ordenar por ${fullLabel}${active ? `, atualmente ${sort.direction === "asc" ? "crescente" : "decrescente"}` : ""}`}
        title={fullLabel}
        onClick={() => {
          setSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
          }));
          setPage(1);
        }}
      >
        <span>{label}</span>
        {fullLabel !== label ? <span className="sr-only">{fullLabel}</span> : null}
        <Icon className={`h-3 w-3 shrink-0 ${active ? "opacity-100" : "opacity-40"}`} aria-hidden />
      </button>
    );
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
                setFilters(DEFAULT_EMPLOYEE_FILTERS);
                setPage(1);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />Limpar filtros
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <ExportButton
            endpoint="/api/export/funcionarios"
            fallbackFileName="export-funcionarios.xlsx"
            params={{
              registration: filters.registration,
              name: filters.name,
              company: filters.company,
              status: filters.status,
              location: filters.location,
              shift: filters.shift,
              area: filters.area,
              client: filters.client,
              responsible1: filters.responsible1,
              responsible2: filters.responsible2,
              admissionFrom: filters.admissionFrom,
              admissionTo: filters.admissionTo,
              dismissalFrom: filters.dismissalFrom,
              dismissalTo: filters.dismissalTo,
              sort: sort.key,
              sortDir: sort.direction,
            }}
          />
          {canManage ? (
            <Button size="sm" variant="outline" asChild>
              <Link href="/rh/funcionarios/importacao"><Upload className="h-4 w-4" aria-hidden />Importar</Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button size="sm" asChild>
              <Link href="/rh/funcionarios/novo"><Plus className="h-4 w-4" aria-hidden />Novo funcionário</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <ListScroll>
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-muted">
            <TableRow>
              <TableHead aria-sort={ariaSort(sort, "registration")}>
                <HeaderLabel sort={sortHeader("registration", "Matrícula")} filter={textFilter("registration", "Matrícula", "matrícula")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "name")}>
                <HeaderLabel sort={sortHeader("name", "Nome")} filter={textFilter("name", "Nome", "nome")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "company_name")}>
                <HeaderLabel
                  sort={sortHeader("company_name", "Empresa")}
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
              <TableHead aria-sort={ariaSort(sort, "admission_date")}>
                <HeaderLabel
                  sort={sortHeader("admission_date", "Admissão")}
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
              <TableHead aria-sort={ariaSort(sort, "dismissal_date")}>
                <HeaderLabel
                  sort={sortHeader("dismissal_date", "Demissão")}
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
              <TableHead aria-sort={ariaSort(sort, "status")}>
                <HeaderLabel
                  sort={sortHeader("status", "Status")}
                  filter={
                    <FilterMenu
                      context="status do funcionário"
                      value={filters.status}
                      active={filters.status !== "ATIVO"}
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
              <TableHead aria-sort={ariaSort(sort, "location")}>
                <HeaderLabel sort={sortHeader("location", "Local")} filter={textFilter("location", "Local", "local")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "shift")}>
                <HeaderLabel sort={sortHeader("shift", "Turno")} filter={textFilter("shift", "Turno", "turno")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "area")}>
                <HeaderLabel sort={sortHeader("area", "Área")} filter={textFilter("area", "Área", "área")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "client")}>
                <HeaderLabel sort={sortHeader("client", "Cliente")} filter={textFilter("client", "Cliente", "cliente")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "responsible_1")}>
                <HeaderLabel sort={sortHeader("responsible_1", "Lid.", "Líder")} filter={textFilter("responsible1", "Líder", "líder")} />
              </TableHead>
              <TableHead aria-sort={ariaSort(sort, "responsible_2")}>
                <HeaderLabel
                  sort={sortHeader("responsible_2", "Enc.", "Encarregado")}
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
