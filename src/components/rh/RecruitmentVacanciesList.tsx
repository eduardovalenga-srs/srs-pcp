"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BriefcaseBusiness, CalendarDays, MapPin, Plus, Search, Users } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RECRUITMENT_REQUEST_REASONS, VACANCY_STATUSES, type VacancyListItem } from "@/lib/types/recruitment";
import type { RecruitmentVacancyStatusValue } from "@/lib/types/database";

const STATUS_BADGE: Record<RecruitmentVacancyStatusValue, { variant: BadgeProps["variant"] }> = {
  VAGAS_ABERTAS: { variant: "success" },
  TRIAGEM: { variant: "muted" },
  ENTREVISTA: { variant: "secondary" },
  AGENDAMENTO_ASO: { variant: "warning" },
  INTEGRACAO: { variant: "outline" },
  CONTRATADOS: { variant: "success" },
};

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
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return vacancies;
    return vacancies.filter((vacancy) =>
      [
        vacancy.title,
        vacancy.customer ?? "",
        vacancy.department,
        vacancy.location ?? "",
        vacancy.requester ?? "",
        vacancy.recruiter ?? "",
      ].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized)),
    );
  }, [query, vacancies]);

  const openCount = vacancies.filter((vacancy) => vacancy.status === "VAGAS_ABERTAS").length;
  const inProgressCount = vacancies.filter(
    (vacancy) => vacancy.status !== "VAGAS_ABERTAS" && vacancy.status !== "CONTRATADOS",
  ).length;
  const hiredCount = vacancies.filter((vacancy) => vacancy.status === "CONTRATADOS").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Vagas abertas" value={openCount} icon={<BriefcaseBusiness className="h-4 w-4" aria-hidden />} />
        <SummaryCard label="Em processo" value={inProgressCount} icon={<CalendarDays className="h-4 w-4" aria-hidden />} />
        <SummaryCard label="Contratados" value={hiredCount} icon={<Users className="h-4 w-4" aria-hidden />} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1">
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
          Nenhuma vaga corresponde à busca.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Quadro de vagas por status">
          {VACANCY_STATUSES.map((status) => {
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
      <p className="text-xs text-muted-foreground">{filtered.length} de {vacancies.length} vaga(s)</p>
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

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </div>
      <span className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</span>
    </div>
  );
}
