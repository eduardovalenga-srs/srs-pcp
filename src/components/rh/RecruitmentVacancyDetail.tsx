"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Loader2, MapPin, Plus, Save, Users } from "lucide-react";
import { toast } from "sonner";

import {
  createRecruitmentCandidateAction,
  saveRecruitmentCandidateScheduleAction,
  updateRecruitmentCandidateStageAction,
  updateRecruitmentVacancyStatusAction,
} from "@/lib/actions/recruitment.actions";
import type {
  RecruitmentCandidateRow,
} from "@/lib/types/database";
import {
  CANDIDATE_STAGES,
  RECRUITMENT_REQUEST_REASONS,
  VACANCY_STATUSES,
  type RecruitmentVacancyDetails,
} from "@/lib/types/recruitment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function dateLabel(date: string | null) {
  if (!date) return "Não informado";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function RecruitmentVacancyDetail({
  vacancy,
  candidates,
  canManage,
}: {
  vacancy: RecruitmentVacancyDetails;
  candidates: RecruitmentCandidateRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(vacancy.status);
  const [selectedCandidateId, setSelectedCandidateId] = useState(vacancy.selected_candidate_id ?? "");
  const requiresSelectedCandidate = ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(status);
  const selectedCandidateLocked =
    Boolean(vacancy.selected_candidate_id) &&
    ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(vacancy.status) &&
    ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(status);
  const selectedStageIsControlledByVacancy = ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(vacancy.status);
  const requestReasonLabel =
    RECRUITMENT_REQUEST_REASONS.find((reason) => reason.value === vacancy.request_reason)?.label ?? vacancy.request_reason;

  function saveStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateRecruitmentVacancyStatusAction({
        id: vacancy.id,
        status,
        selectedCandidateId: requiresSelectedCandidate ? selectedCandidateId || null : null,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  function changeCandidateStage(candidate: RecruitmentCandidateRow, stage: string) {
    startTransition(async () => {
      const result = await updateRecruitmentCandidateStageAction({
        id: candidate.id,
        stage,
        vacancyId: vacancy.id,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  const meta = "flex items-center gap-1.5 text-sm text-muted-foreground";
  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{vacancy.title}</h2>
              <Badge variant={vacancy.status === "VAGAS_ABERTAS" || vacancy.status === "CONTRATADOS" ? "success" : "outline"}>
                {VACANCY_STATUSES.find((item) => item.value === vacancy.status)?.label ?? vacancy.status}
              </Badge>
              <Badge variant={vacancy.priority === "ALTA" ? "destructive" : "secondary"}>
                Prioridade {vacancy.priority.toLocaleLowerCase("pt-BR")}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <span className={meta}><Users className="h-4 w-4" aria-hidden />{vacancy.department}</span>
              {vacancy.customer ? <span className={meta}>Cliente: {vacancy.customer}</span> : null}
              <span className={meta}>Motivo: {requestReasonLabel}</span>
              {vacancy.replacement_employee_name ? (
                <span className={meta}>Substituição de: {vacancy.replacement_employee_name}</span>
              ) : null}
              {vacancy.location ? <span className={meta}><MapPin className="h-4 w-4" aria-hidden />{vacancy.location}</span> : null}
              <span className={meta}><CalendarDays className="h-4 w-4" aria-hidden />Abertura: {dateLabel(vacancy.opening_date)}</span>
              <span className={meta}><CalendarDays className="h-4 w-4" aria-hidden />Prazo: {dateLabel(vacancy.target_date)}</span>
              <span className={meta}>{vacancy.employment_type}</span>
              {vacancy.salary_range ? <span className={meta}>Faixa salarial: {vacancy.salary_range}</span> : null}
              {vacancy.requester ? <span className={meta}>Solicitante: {vacancy.requester}</span> : null}
              {vacancy.recruiter ? <span className={meta}>Recrutador(a): {vacancy.recruiter}</span> : null}
            </div>
          </div>
          {canManage ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/rh/vagas/${vacancy.id}/editar`}>Editar vaga</Link>
            </Button>
          ) : null}
        </div>

        {(vacancy.description || vacancy.requirements) ? (
          <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
            {vacancy.description ? (
              <div>
                <h3 className="text-sm font-medium">Descrição</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{vacancy.description}</p>
              </div>
            ) : null}
            {vacancy.requirements ? (
              <div>
                <h3 className="text-sm font-medium">Requisitos e qualificações</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{vacancy.requirements}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {canManage ? (
        <form onSubmit={saveStatus} className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="vacancyStatus">Etapa da vaga</Label>
            <select
              id="vacancyStatus"
              value={status}
              onChange={(event) => {
                const nextStatus = event.target.value as typeof status;
                setStatus(nextStatus);
                if (!["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(nextStatus)) {
                  setSelectedCandidateId("");
                }
              }}
              className={selectClass}
              disabled={pending}
            >
              {VACANCY_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          {requiresSelectedCandidate ? (
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor="selectedCandidate">Candidato que seguirá na vaga *</Label>
              <select
                id="selectedCandidate"
                value={selectedCandidateId}
                onChange={(event) => setSelectedCandidateId(event.target.value)}
                className={selectClass}
                required
                disabled={pending || selectedCandidateLocked}
              >
                <option value="">Selecione o candidato</option>
                {candidates
                  .filter((candidate) => candidate.stage !== "REPROVADO")
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
              </select>
            </div>
          ) : null}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Atualizar status
          </Button>
        </form>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Candidatos <span className="text-sm font-normal text-muted-foreground">({candidates.length})</span></h2>
            <p className="text-sm text-muted-foreground">Acompanhe o avanço de cada pessoa no processo seletivo.</p>
          </div>
          {canManage ? <AddCandidateDialog vacancyId={vacancy.id} /> : null}
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          {candidates.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Candidato</th>
                    <th className="px-4 py-3 font-medium">Contato</th>
                    <th className="px-4 py-3 font-medium">Origem</th>
                    <th className="px-4 py-3 font-medium">Etapa</th>
                    <th className="px-4 py-3 font-medium">Agenda</th>
                    <th className="px-4 py-3 font-medium">Observações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {candidates.map((candidate) => (
                    <tr key={candidate.id} className="align-top">
                      <td className="px-4 py-3 font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{candidate.name}</span>
                          {vacancy.selected_candidate_id === candidate.id ? <Badge variant="success">Selecionado</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {candidate.email ? <a href={`mailto:${candidate.email}`} className="block hover:underline">{candidate.email}</a> : null}
                        {candidate.phone ? <a href={`tel:${candidate.phone}`} className="block hover:underline">{candidate.phone}</a> : null}
                        {!candidate.email && !candidate.phone ? "—" : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{candidate.source || "—"}</td>
                      <td className="px-4 py-3">
                        {canManage && !(selectedStageIsControlledByVacancy && vacancy.selected_candidate_id === candidate.id) ? (
                          <select
                            value={candidate.stage}
                            onChange={(event) => changeCandidateStage(candidate, event.target.value)}
                            className={`${selectClass} min-w-36`}
                            aria-label={`Etapa de ${candidate.name}`}
                            disabled={pending || (selectedStageIsControlledByVacancy && vacancy.selected_candidate_id === candidate.id)}
                          >
                            {CANDIDATE_STAGES
                              .filter((stage) => ["TRIAGEM", "ENTREVISTA", "REPROVADO"].includes(stage.value))
                              .map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
                          </select>
                        ) : <Badge variant="outline">{CANDIDATE_STAGES.find((stage) => stage.value === candidate.stage)?.label ?? candidate.stage}</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <CandidateScheduleEditor
                          candidate={candidate}
                          vacancyId={vacancy.id}
                          selected={
                            vacancy.selected_candidate_id === candidate.id ||
                            (status === "CONTRATADOS" && selectedCandidateId === candidate.id)
                          }
                          canManage={canManage}
                        />
                      </td>
                      <td className="max-w-56 px-4 py-3 text-muted-foreground">
                        {candidate.notes ? <span title={candidate.notes} className="line-clamp-2">{candidate.notes}</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <Users className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden />
              <p className="mt-2 font-medium">Ainda não há candidatos nesta vaga</p>
              {canManage ? <p className="mt-1 text-sm text-muted-foreground">Cadastre candidatos para acompanhar cada etapa da seleção.</p> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dateTimeLocalToIso(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function scheduleLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "—";
}

function CandidateScheduleEditor({
  candidate,
  vacancyId,
  selected,
  canManage,
}: {
  candidate: RecruitmentCandidateRow;
  vacancyId: string;
  selected: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [interviewScheduledAt, setInterviewScheduledAt] = useState(
    toDateTimeLocal(candidate.interview_scheduled_at),
  );
  const [interviewerName, setInterviewerName] = useState(candidate.interviewer_name ?? "");

  function submit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await saveRecruitmentCandidateScheduleAction({
        id: candidate.id,
        vacancyId,
        triageScheduledAt: dateTimeLocalToIso(formData.get("triageScheduledAt")),
        interviewScheduledAt: dateTimeLocalToIso(formData.get("interviewScheduledAt")),
        interviewerName: String(formData.get("interviewerName") ?? "") || null,
        asoScheduledAt: selected
          ? dateTimeLocalToIso(formData.get("asoScheduledAt"))
          : candidate.aso_scheduled_at,
        integrationScheduledAt: selected
          ? dateTimeLocalToIso(formData.get("integrationScheduledAt"))
          : candidate.integration_scheduled_at,
        hiredAt: selected
          ? String(formData.get("hiredAt") ?? "") || null
          : candidate.hired_at,
      });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  if (!canManage) {
    return (
      <div className="min-w-48 space-y-1 text-xs text-muted-foreground">
        <p>Triagem: {scheduleLabel(candidate.triage_scheduled_at)}</p>
        <p>
          Entrevista: {scheduleLabel(candidate.interview_scheduled_at)}
          {candidate.interviewer_name ? ` · Entrevistador(a): ${candidate.interviewer_name}` : ""}
        </p>
        <p>ASO: {scheduleLabel(candidate.aso_scheduled_at)}</p>
        <p>Integração: {scheduleLabel(candidate.integration_scheduled_at)}</p>
        <p>Contratação: {candidate.hired_at ? dateLabel(candidate.hired_at) : "—"}</p>
      </div>
    );
  }

  return (
    <details className="min-w-48">
      <summary className="cursor-pointer text-sm text-primary">Agendar etapas</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Entrevista: {scheduleLabel(candidate.interview_scheduled_at)}
        {candidate.interviewer_name ? ` · Entrevistador(a): ${candidate.interviewer_name}` : ""}
      </p>
      <form action={submit} className="mt-2 grid min-w-60 gap-2 rounded-md border bg-background p-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`triage-${candidate.id}`} className="text-xs">Triagem</Label>
          <Input id={`triage-${candidate.id}`} name="triageScheduledAt" type="datetime-local" defaultValue={toDateTimeLocal(candidate.triage_scheduled_at)} disabled={pending} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`interview-${candidate.id}`} className="text-xs">Entrevista</Label>
          <Input
            id={`interview-${candidate.id}`}
            name="interviewScheduledAt"
            type="datetime-local"
            value={interviewScheduledAt}
            onChange={(event) => {
              setInterviewScheduledAt(event.target.value);
              if (!event.target.value) setInterviewerName("");
            }}
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`interviewer-${candidate.id}`} className="text-xs">
            Quem fará a entrevista{interviewScheduledAt ? " *" : ""}
          </Label>
          <Input
            id={`interviewer-${candidate.id}`}
            name="interviewerName"
            value={interviewerName}
            onChange={(event) => setInterviewerName(event.target.value)}
            maxLength={150}
            required={Boolean(interviewScheduledAt)}
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`aso-${candidate.id}`} className="text-xs">Agendamento ASO</Label>
          <Input id={`aso-${candidate.id}`} name="asoScheduledAt" type="datetime-local" defaultValue={toDateTimeLocal(candidate.aso_scheduled_at)} disabled={pending || !selected} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`integration-${candidate.id}`} className="text-xs">Integração</Label>
          <Input id={`integration-${candidate.id}`} name="integrationScheduledAt" type="datetime-local" defaultValue={toDateTimeLocal(candidate.integration_scheduled_at)} disabled={pending || !selected} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`hired-${candidate.id}`} className="text-xs">Data da contratação</Label>
          <Input id={`hired-${candidate.id}`} name="hiredAt" type="date" defaultValue={candidate.hired_at ?? ""} disabled={pending || !selected} />
        </div>
        {!selected ? (
          <p className="self-end text-xs text-muted-foreground">Selecione este candidato na etapa ASO para agendar ASO, integração ou contratação.</p>
        ) : null}
        {error ? <p role="alert" className="text-xs text-destructive sm:col-span-2">{error}</p> : null}
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salvar datas
          </Button>
        </div>
      </form>
    </details>
  );
}

function AddCandidateDialog({ vacancyId }: { vacancyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function submit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await createRecruitmentCandidateAction({
        vacancyId,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? "") || null,
        phone: String(formData.get("phone") ?? "") || null,
        source: String(formData.get("source") ?? "") || null,
        notes: String(formData.get("notes") ?? "") || null,
      });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" aria-hidden />Adicionar candidato</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo candidato</DialogTitle>
          <DialogDescription>Cadastre os dados necessários para acompanhar esta candidatura.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="candidateName">Nome completo *</Label>
            <Input id="candidateName" name="name" maxLength={180} required autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="candidateEmail">E-mail</Label>
              <Input id="candidateEmail" name="email" type="email" maxLength={254} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidatePhone">Telefone</Label>
              <Input id="candidatePhone" name="phone" type="tel" maxLength={40} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="candidateSource">Origem</Label>
            <Input id="candidateSource" name="source" maxLength={120} placeholder="Ex.: indicação, site, rede social" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="candidateNotes">Observações</Label>
            <Textarea id="candidateNotes" name="notes" maxLength={2000} rows={3} />
          </div>
          <p className="text-xs text-muted-foreground">Acesso aos dados dos candidatos é restrito à equipe autorizada de recrutamento.</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Cadastrar candidato
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
