"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, Plus, RotateCcw, Search, Upload } from "lucide-react";

import type { EmployeeRow } from "@/lib/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 25;
type Filters = {
  search: string;
  company: string;
  status: string;
  location: string;
  shift: string;
  area: string;
  client: string;
  responsible1: string;
  responsible2: string;
  admissionFrom: string;
  admissionTo: string;
  dismissalFrom: string;
  dismissalTo: string;
};
const EMPTY_FILTERS: Filters = {
  search: "", company: "", status: "", location: "", shift: "", area: "", client: "",
  responsible1: "", responsible2: "", admissionFrom: "", admissionTo: "", dismissalFrom: "", dismissalTo: "",
};

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function uniqueValues(employees: EmployeeRow[], field: "location" | "shift" | "area" | "client" | "responsible_1" | "responsible_2") {
  return [...new Set(employees.map((employee) => employee[field]).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function EmployeesList({ employees, canManage }: { employees: EmployeeRow[]; canManage: boolean }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const distinct = {
    locations: uniqueValues(employees, "location"),
    shifts: uniqueValues(employees, "shift"),
    areas: uniqueValues(employees, "area"),
    clients: uniqueValues(employees, "client"),
    responsible1: uniqueValues(employees, "responsible_1"),
    responsible2: uniqueValues(employees, "responsible_2"),
  };
  const filtered = useMemo(() => {
    const includes = (value: string | null, filter: string) =>
      !filter || (value ?? "").toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR"));
    return employees.filter((employee) => {
      const search = filters.search.trim().toLocaleLowerCase("pt-BR");
      const searchMatch = !search ||
        [employee.registration, employee.name, employee.company_name, employee.location ?? ""]
          .some((value) => value.toLocaleLowerCase("pt-BR").includes(search));
      return searchMatch &&
        (!filters.company || employee.company_code === filters.company) &&
        (!filters.status || employee.status === filters.status) &&
        includes(employee.location, filters.location) &&
        includes(employee.shift, filters.shift) &&
        includes(employee.area, filters.area) &&
        includes(employee.client, filters.client) &&
        includes(employee.responsible_1, filters.responsible1) &&
        includes(employee.responsible_2, filters.responsible2) &&
        (!filters.admissionFrom || (employee.admission_date ?? "") >= filters.admissionFrom) &&
        (!filters.admissionTo || (employee.admission_date ?? "") <= filters.admissionTo) &&
        (!filters.dismissalFrom || (employee.dismissal_date ?? "") >= filters.dismissalFrom) &&
        (!filters.dismissalTo || (employee.dismissal_date ?? "") <= filters.dismissalTo);
    });
  }, [employees, filters]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function selectFilter<K extends keyof Filters>(key: K, label: string, values: string[]) {
    return (
      <label className="min-w-36 space-y-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <select
          value={filters[key] as string}
          onChange={(event) => update(key, event.target.value as Filters[K])}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">Todos</option>
          {values.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{filtered.length} de {employees.length} funcionário(s)</p>
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

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
            <span>Busca (matrícula, nome, empresa ou local)</span>
            <span className="relative block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4" aria-hidden />
              <Input className="pl-9" value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="Buscar funcionário..." />
            </span>
          </label>
          <label className="min-w-36 space-y-1 text-xs text-muted-foreground">
            <span>Empresa</span>
            <select
              value={filters.company}
              onChange={(event) => update("company", event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">Todas</option>
              {[...new Map(employees.map((employee) => [employee.company_code, employee.company_name])).entries()].map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </select>
          </label>
          {selectFilter("status", "Status", ["ATIVO", "INATIVO"])}
          {selectFilter("location", "Local", distinct.locations)}
          {selectFilter("shift", "Turno", distinct.shifts)}
          {selectFilter("area", "Área", distinct.areas)}
          {selectFilter("client", "Cliente", distinct.clients)}
          {selectFilter("responsible1", "Responsável 1", distinct.responsible1)}
          {selectFilter("responsible2", "Responsável 2", distinct.responsible2)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["admissionFrom", "Admissão a partir de"],
            ["admissionTo", "Admissão até"],
            ["dismissalFrom", "Demissão a partir de"],
            ["dismissalTo", "Demissão até"],
          ] as const).map(([key, label]) => (
            <label key={key} className="space-y-1 text-xs text-muted-foreground">
              <span>{label}</span>
              <Input type="date" value={filters[key]} onChange={(event) => update(key, event.target.value)} />
            </label>
          ))}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />Limpar filtros
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Matrícula</TableHead><TableHead>Nome</TableHead><TableHead>Empresa</TableHead>
              <TableHead>Admissão</TableHead><TableHead>Demissão</TableHead><TableHead>Status</TableHead>
              <TableHead>Local</TableHead><TableHead>Turno</TableHead><TableHead>Área</TableHead>
              <TableHead>Cliente</TableHead><TableHead>Responsáveis</TableHead>
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
                <TableCell>{[employee.responsible_1, employee.responsible_2].filter(Boolean).join(" / ") || "—"}</TableCell>
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
              <TableRow><TableCell colSpan={canManage ? 12 : 11} className="py-8 text-center text-muted-foreground">Nenhum funcionário encontrado para os filtros informados.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Página {page} de {pageCount}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
        </div>
      </div>
    </section>
  );
}
