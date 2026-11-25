"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveRecruitmentVacancyAction } from "@/lib/actions/recruitment.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RecruitmentVacancyRow } from "@/lib/types/database";
import {
  EMPLOYMENT_TYPES,
  RECRUITMENT_REQUEST_REASONS,
  normalizeRecruitmentLabel,
  type RecruitmentFormOptions,
} from "@/lib/types/recruitment";

export function RecruitmentVacancyForm({
  vacancy = null,
  options,
}: {
  vacancy?: RecruitmentVacancyRow | null;
  options: RecruitmentFormOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openingDate] = useState(vacancy?.opening_date ?? new Date().toISOString().slice(0, 10));

  const initialCustomer = options.customers.find(
    (customer) => normalizeRecruitmentLabel(customer.name) === normalizeRecruitmentLabel(vacancy?.customer ?? ""),
  );
  const initialLocation = initialCustomer?.locations.find(
    (location) =>
      location.id === vacancy?.allocation_location_id ||
      normalizeRecruitmentLabel(location.name) === normalizeRecruitmentLabel(vacancy?.location ?? ""),
  );
  const initialArea = initialLocation?.areas.find(
    (area) =>
      area.id === vacancy?.allocation_area_id ||
      normalizeRecruitmentLabel(area.name) === normalizeRecruitmentLabel(vacancy?.department ?? ""),
  );
  const initialPosition = initialArea?.positions.find(
    (position) =>
      position.id === vacancy?.allocation_position_id ||
      normalizeRecruitmentLabel(position.name) === normalizeRecruitmentLabel(vacancy?.title ?? ""),
  );
  const initialApprovedRole = initialCustomer?.approvedRoles.find(
    (role) => role.id === vacancy?.approved_role_id && role.clientId === initialLocation?.clientId,
  );
  const initialReplacementEmployee = initialCustomer?.employees.find(
    (employee) =>
      employee.id === vacancy?.replacement_employee_id &&
      (!initialLocation || employee.clientId === initialLocation.clientId),
  );
  const [customerName, setCustomerName] = useState(initialCustomer?.name ?? "");
  const [locationId, setLocationId] = useState(initialLocation?.id ?? "");
  const [areaId, setAreaId] = useState(initialArea?.id ?? "");
  const [cargoSelection, setCargoSelection] = useState(
    initialApprovedRole?.id ??
      (vacancy?.allocation_position_id && !vacancy.approved_role_id && initialPosition
        ? `legacy:${initialPosition.id}`
        : ""),
  );
  const [requestReason, setRequestReason] = useState(vacancy?.request_reason ?? "NOVA_VAGA");
  const [replacementEmployeeId, setReplacementEmployeeId] = useState(initialReplacementEmployee?.id ?? "");

  const selectedCustomer = options.customers.find((customer) => customer.name === customerName);
  const selectedLocation = selectedCustomer?.locations.find((location) => location.id === locationId);
  const areas = selectedLocation?.areas ?? [];
  const selectedArea = areas.find((area) => area.id === areaId);
  const approvedRoles = (selectedCustomer?.approvedRoles ?? []).filter(
    (role) =>
      role.clientId === selectedLocation?.clientId &&
      (role.active || role.id === vacancy?.approved_role_id),
  );
  const canKeepLegacyPosition = Boolean(
    vacancy &&
      !vacancy.approved_role_id &&
      vacancy.allocation_position_id === initialPosition?.id &&
      initialPosition &&
      selectedLocation?.id === initialLocation?.id &&
      selectedArea?.id === initialArea?.id,
  );
  const employees = (selectedCustomer?.employees ?? []).filter(
    (employee) => !selectedLocation || employee.clientId === selectedLocation.clientId,
  );
  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const field = "space-y-1.5";
  const replacing = requestReason === "SUBSTITUICAO";

  function submit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await saveRecruitmentVacancyAction({
        id: vacancy?.id ?? null,
        customer: String(formData.get("customer") ?? ""),
        allocationClientId: String(formData.get("allocationClientId") ?? ""),
        allocationLocationId: String(formData.get("allocationLocationId") ?? ""),
        allocationAreaId: String(formData.get("allocationAreaId") ?? ""),
        approvedRoleId: String(formData.get("cargoSelection") ?? "").startsWith("legacy:")
          ? null
          : String(formData.get("cargoSelection") ?? "") || null,
        allocationPositionId: String(formData.get("cargoSelection") ?? "").startsWith("legacy:")
          ? String(formData.get("cargoSelection") ?? "").slice("legacy:".length)
          : null,
        requestReason: String(formData.get("requestReason") ?? "") as "NOVA_VAGA" | "SUBSTITUICAO" | "REFORCO",
        replacementEmployeeId: String(formData.get("replacementEmployeeId") ?? "") || null,
        employmentType: String(formData.get("employmentType") ?? "CLT"),
        description: String(formData.get("description") ?? "") || null,
        requirements: String(formData.get("requirements") ?? "") || null,
        salaryRange: String(formData.get("salaryRange") ?? "") || null,
        requester: String(formData.get("requester") ?? ""),
        recruiter: String(formData.get("recruiter") ?? "") || null,
        priority: String(formData.get("priority") ?? "NORMAL") as "BAIXA" | "NORMAL" | "ALTA",
        status: vacancy?.status ?? "VAGAS_ABERTAS",
        openingDate: String(formData.get("openingDate") ?? ""),
        targetDate: String(formData.get("targetDate") ?? "") || null,
        closedReason: null,
      });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.push(vacancy ? `/rh/vagas/${vacancy.id}` : `/rh/vagas/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-5 rounded-lg border bg-card p-4 sm:p-6" aria-label={vacancy ? "Editar vaga" : "Abrir vaga"}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={`${field} sm:col-span-2 lg:col-span-3`}>
          <Label htmlFor="customer">Cliente *</Label>
          <select
            id="customer"
            name="customer"
            value={customerName}
            onChange={(event) => {
              setCustomerName(event.target.value);
              setLocationId("");
              setAreaId("");
              setCargoSelection("");
              setReplacementEmployeeId("");
            }}
            className={selectClass}
            required
            disabled={pending}
          >
            <option value="">Selecione o cliente</option>
            {options.customers.map((customer) => (
              <option key={customer.name} value={customer.name}>{customer.name}</option>
            ))}
          </select>
        </div>

        <div className={field}>
          <Label htmlFor="allocationLocationId">Local de trabalho *</Label>
          <select
            id="allocationLocationId"
            name="allocationLocationId"
            value={locationId}
            onChange={(event) => {
              const nextId = event.target.value;
              setLocationId(nextId);
              setAreaId("");
              setCargoSelection("");
              const nextLocation = selectedCustomer?.locations.find((location) => location.id === nextId);
              if (replacementEmployeeId && nextLocation &&
                  !selectedCustomer?.employees.some(
                    (employee) => employee.id === replacementEmployeeId && employee.clientId === nextLocation.clientId,
                  )) {
                setReplacementEmployeeId("");
              }
            }}
            className={selectClass}
            required
            disabled={!selectedCustomer || pending}
          >
            <option value="">{selectedCustomer ? "Selecione o local" : "Selecione primeiro o cliente"}</option>
          {(selectedCustomer?.locations ?? []).map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
          </select>
          {selectedCustomer && selectedCustomer.locations.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum local ativo está cadastrado para este cliente.</p>
          ) : null}
        </div>
        <div className={field}>
          <Label htmlFor="allocationAreaId">Área *</Label>
          <select
            id="allocationAreaId"
            name="allocationAreaId"
            value={areaId}
            onChange={(event) => {
              setAreaId(event.target.value);
              setCargoSelection("");
            }}
            className={selectClass}
            required
            disabled={!selectedLocation || pending}
          >
            <option value="">{selectedLocation ? "Selecione a área" : "Selecione primeiro o local"}</option>
            {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
          {selectedLocation && areas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma área ativa está cadastrada para este local.</p>
          ) : null}
        </div>
        <div className={field}>
          <Label htmlFor="cargoSelection">Cargo aprovado *</Label>
          <select
            id="cargoSelection"
            name="cargoSelection"
            value={cargoSelection}
            onChange={(event) => setCargoSelection(event.target.value)}
            className={selectClass}
            required
            disabled={!selectedArea || pending || (approvedRoles.length === 0 && !canKeepLegacyPosition)}
          >
            <option value="">
              {!selectedArea ? "Selecione primeiro a área" : approvedRoles.length ? "Selecione o cargo aprovado" : "Nenhum cargo aprovado cadastrado"}
            </option>
            {approvedRoles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
            {canKeepLegacyPosition && initialPosition ? (
              <option value={`legacy:${initialPosition.id}`}>
                {initialPosition.name} · {initialPosition.shiftName} (vaga existente)
              </option>
            ) : null}
          </select>
          {selectedArea && approvedRoles.length === 0 && !canKeepLegacyPosition ? (
            <p className="text-xs text-muted-foreground">Cadastre um cargo aprovado para este cliente antes de abrir a vaga.</p>
          ) : null}
          <input type="hidden" name="allocationClientId" value={selectedLocation?.clientId ?? ""} />
        </div>

        <div className={field}>
          <Label htmlFor="requestReason">Motivo da solicitação *</Label>
          <select
            id="requestReason"
            name="requestReason"
            value={requestReason}
            onChange={(event) => {
              const nextReason = event.target.value as typeof requestReason;
              setRequestReason(nextReason);
              if (nextReason !== "SUBSTITUICAO") setReplacementEmployeeId("");
            }}
            className={selectClass}
            disabled={pending}
          >
            {RECRUITMENT_REQUEST_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>{reason.label}</option>
            ))}
          </select>
        </div>
        <div className={field}>
          <Label htmlFor="requester">Solicitante / gestor *</Label>
          <Input id="requester" name="requester" defaultValue={vacancy?.requester ?? ""} maxLength={150} required disabled={pending} />
        </div>
        {replacing ? (
          <div className={field}>
            <Label htmlFor="replacementEmployeeId">Funcionário substituído *</Label>
            <select
              id="replacementEmployeeId"
              name="replacementEmployeeId"
              value={replacementEmployeeId}
              onChange={(event) => setReplacementEmployeeId(event.target.value)}
              className={selectClass}
              required
              disabled={!selectedCustomer || employees.length === 0 || pending}
            >
              <option value="">
                {!selectedCustomer ? "Selecione primeiro o cliente" : employees.length ? "Selecione o funcionário" : "Nenhum funcionário alocado encontrado"}
              </option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={field}>
          <Label htmlFor="employmentType">Tipo de contratação *</Label>
          <select id="employmentType" name="employmentType" defaultValue={vacancy?.employment_type ?? "CLT"} className={selectClass} disabled={pending}>
            {EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div className={field}>
          <Label htmlFor="priority">Prioridade</Label>
          <select id="priority" name="priority" defaultValue={vacancy?.priority ?? "NORMAL"} className={selectClass} disabled={pending}>
            <option value="BAIXA">Baixa</option>
            <option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option>
          </select>
        </div>
        <div className={field}>
          <Label htmlFor="openingDate">Data de abertura *</Label>
          <Input id="openingDate" name="openingDate" type="date" defaultValue={openingDate} required disabled={pending} />
        </div>
        <div className={field}>
          <Label htmlFor="targetDate">Previsão para fechamento</Label>
          <Input id="targetDate" name="targetDate" type="date" defaultValue={vacancy?.target_date ?? ""} disabled={pending} />
        </div>
        <div className={field}>
          <Label htmlFor="salaryRange">Faixa salarial</Label>
          <Input id="salaryRange" name="salaryRange" defaultValue={vacancy?.salary_range ?? ""} maxLength={120} placeholder="Ex.: a combinar" disabled={pending} />
        </div>
        <div className={field}>
          <Label htmlFor="recruiter">Recrutador(a) responsável</Label>
          <Input id="recruiter" name="recruiter" defaultValue={vacancy?.recruiter ?? ""} maxLength={150} disabled={pending} />
        </div>
        <div className={`${field} sm:col-span-2 lg:col-span-3`}>
          <Label htmlFor="description">Descrição da vaga</Label>
          <Textarea id="description" name="description" defaultValue={vacancy?.description ?? ""} maxLength={5000} rows={4} disabled={pending} />
        </div>
        <div className={`${field} sm:col-span-2 lg:col-span-3`}>
          <Label htmlFor="requirements">Requisitos e qualificações</Label>
          <Textarea id="requirements" name="requirements" defaultValue={vacancy?.requirements ?? ""} maxLength={5000} rows={4} disabled={pending} />
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Salvar vaga
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={vacancy ? `/rh/vagas/${vacancy.id}` : "/rh/vagas"}>
            <ArrowLeft className="h-4 w-4" aria-hidden />Cancelar
          </Link>
        </Button>
      </div>
    </form>
  );
}
