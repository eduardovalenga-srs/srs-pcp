"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BriefcaseBusiness, CalendarDays, MapPin, Plus, Search, Users } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RECRUITMENT_REQUEST_REASONS, VACANCY_STATUSES, type VacancyListItem } from "@/lib/types/recruitment";
import type { RecruitmentVacancyStatusValue } from "@/lib/types/database";
import {
  ALL_RECRUITMENT_CUSTOMERS,
  filterRecruitmentVacancies,
  getRecruitmentCustomerOptions,
} from "@/lib/utils/recruitment-vacancies";

const STATUS_BADGE: Record<RecruitmentVacancyStatusValue, { variant: BadgeProps["variant"] }> = {
  VAGAS_ABERTAS: { variant: "success" },
  TRIAGEM: { variant: "muted" },
  ENTREVISTA: { variant: "secondary" },
  AGENDAMENTO_ASO: { variant: "warning" },
  INTEGRACAO: { variant: "outline" },
  CONTRATADOS: { variant: "success" },
};
const BOARD_STATUSES = VACANCY_STATUSES.filter((status) => status.value !== "CONTRATADOS");

function dateLabel(date: string | null) {
  if (!date) return "Sem previsão";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function RecruitmentVacanciesList({
  vacancies,
  canManage,
}: {
  vacancies: VacancyListItem[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState(ALL_RECRUITMENT_CUSTOMERS);
  const [showContracted, setShowContracted] = useState(false);
  const customerOptions = useMemo(() => getRecruitmentCustomerOptions(vacancies), [vacancies]);
  const customerVacancies = useMemo(
    () => customerFilter === ALL_RECRUITMENT_CUSTOMERS
      ? vacancies
      : vacancies.filter((vacancy) => vacancy.customer?.trim() === customerFilter),
    [customerFilter, vacancies],
  );
  const filtered = useMemo(() => {
    return filterRecruitmentVacancies(vacancies, {
      query,
      customer: customerFilter,
      showContracted,
    });
  }, [customerFilter, query, showContracted, vacancies]);

  const openCount = customerVacancies.filter((vacancy) => vacancy.status === "VAGAS_ABERTAS").length;
  const inProgressCount = customerVacancies.filter(
    (vacancy) => vacancy.status !== "VAGAS_ABERTAS" && vacancy.status !== "CONTRATADOS",
  ).length;
  const hiredCount = customerVacancies.filter((vacancy) => vacancy.status === "CONTRATADOS").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Vagas abertas" value={openCount} icon={<BriefcaseBusiness className="h-4 w-4" aria-hidden />} />
        <SummaryCard label="Em processo" value={inProgressCount} icon={<CalendarDays className="h-4 w-4" aria-hidden />} />
        <SummaryCard
          label="Contratados"
          value={hiredCount}
          icon={<Users className="h-4 w-4" aria-hidden />}
          onClick={() => setShowContracted((current) => !current)}
          active={showContracted}
        />
      </div>

      <div className="grid items-end gap-3 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.5fr)_auto]">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          <span>Cliente</span>
          <select
            value={customerFilter}
            onChange={(event) => setCustomerFilter(event.target.value)}
            aria-label="Filtrar vagas por cliente"
            className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm font-normal shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value={ALL_RECRUITMENT_CUSTOMERS}>Todos os clientes</option>
            {customerOptions.map((customer) => (
              <option key={customer} value={customer}>{customer}</option>
            ))}
          </select>
        </label>
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cargo, cliente ou responsável"
            aria-label="Buscar vagas"
            className="pl-9"
          />
        </div>
        {canManage ? (
          <Button asChild>
            <Link href="/rh/vagas/novo"><Plus className="h-4 w-4" aria-hidden />Abrir vaga</Link>
          </Button>
        ) : null}
      </div>

      {vacancies.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center">
          <BriefcaseBusiness className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden />
          <p className="mt-3 font-medium">Nenhuma vaga cadastrada</p>
          <p className="mt-1 text-sm text-muted-foreground">Abra a primeira vaga para começar a organizar o recrutamento.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {showContracted
            ? "Nenhuma vaga contratada corresponde aos filtros."
            : "Nenhuma vaga aberta ou em processo corresponde aos filtros. Use o card Contratados para consultar as vagas contratadas."}
        </div>
      ) : showContracted ? (
        <section aria-label="Lista de vagas contratadas" className="space-y-3">
          <h2 className="text-sm font-semibold">Vagas contratadas ({filtered.length})</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((vacancy) => <VacancyCard key={vacancy.id} vacancy={vacancy} />)}
          </div>
        </section>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Quadro de vagas por status">
          {BOARD_STATUSES.map((status) => {
            const columnVacancies = filtered.filter((vacancy) => vacancy.status === status.value);
            const badge = STATUS_BADGE[status.value];
            return (
              <section
                key={status.value}
                aria-label={`${status.label}: ${columnVacancies.length} vaga(s)`}
                className="flex w-[min(86vw,19rem)] shrink-0 flex-col rounded-lg border bg-muted/30 sm:w-72"
              >
                <header className="flex items-center justify-between gap-2 border-b px-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={badge.variant}>{status.label}</Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">{columnVacancies.length}</span>
                  </div>
                </header>
                <div className="flex min-h-28 flex-col gap-2 p-2">
                  {columnVacancies.length ? columnVacancies.map((vacancy) => (
                    <VacancyCard key={vacancy.id} vacancy={vacancy} />
                  )) : (
                    <p className="px-2 py-5 text-center text-xs text-muted-foreground">Nenhuma vaga</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {filtered.length} vaga(s) encontrada(s) entre {customerVacancies.length} cadastrada(s) no escopo do cliente.
      </p>
    </div>
  );
}

function VacancyCard({ vacancy }: { vacancy: VacancyListItem }) {
  const reasonLabel = RECRUITMENT_REQUEST_REASONS.find((reason) => reason.value === vacancy.request_reason)?.label;
  return (
    <Link
      href={`/rh/vagas/${vacancy.id}`}
      className="block space-y-3 rounded-md border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div>
        <h2 className="line-clamp-2 text-sm font-semibold">{vacancy.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{vacancy.customer || "Cliente não informado"}</p>
      </div>
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{vacancy.location || "Local não informado"} · {vacancy.department}</p>
        {vacancy.selected_candidate_name ? (
          <p>Candidato selecionado: {vacancy.selected_candidate_name}</p>
        ) : null}
        {vacancy.status === "CONTRATADOS" && vacancy.selected_candidate_hired_at ? (
          <p>Contratado em: {dateLabel(vacancy.selected_candidate_hired_at)}</p>
        ) : null}
        {reasonLabel ? <p>Motivo: {reasonLabel}</p> : null}
        {vacancy.requester ? <p>Solicitante: {vacancy.requester}</p> : null}
        {vacancy.recruiter ? <p>Recrutamento: {vacancy.recruiter}</p> : null}
      </div>
      <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{vacancy.candidate_count} candidato(s)</span>
        <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{dateLabel(vacancy.target_date)}</span>
      </div>
    </Link>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  onClick,
  active = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = [
    "flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left",
    onClick ? "cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "",
    active ? "border-primary bg-accent/30" : "",
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </div>
      <span className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
