"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveEmployeeAction } from "@/lib/actions/employees.actions";
import { EMPLOYEE_COMPANIES } from "@/lib/types/employee";
import type { EmployeeRow } from "@/lib/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EmployeeFormProps = { employee?: EmployeeRow | null };

export function EmployeeForm({ employee = null }: EmployeeFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [companyCode, setCompanyCode] = useState(employee?.company_code ?? "752");
  const company = EMPLOYEE_COMPANIES.find((item) => item.code === companyCode) ?? EMPLOYEE_COMPANIES[0]!;

  function submit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await saveEmployeeAction({
        id: employee?.id ?? null,
        companyCode,
        companyName: company.name,
        registration: String(formData.get("registration") ?? ""),
        name: String(formData.get("name") ?? ""),
        admissionDate: String(formData.get("admissionDate") ?? "") || null,
        dismissalDate: String(formData.get("dismissalDate") ?? "") || null,
        location: String(formData.get("location") ?? "") || null,
        shift: String(formData.get("shift") ?? "") || null,
        area: String(formData.get("area") ?? "") || null,
        client: String(formData.get("client") ?? "") || null,
        responsible1: String(formData.get("responsible1") ?? "") || null,
        responsible2: String(formData.get("responsible2") ?? "") || null,
      });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.push("/rh/funcionarios");
    });
  }

  const fieldClass = "space-y-1.5";
  return (
    <form
      action={submit}
      className="space-y-5 rounded-lg border bg-card p-4 sm:p-6"
      aria-label={employee ? "Editar funcionário" : "Novo funcionário"}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={fieldClass}>
          <Label htmlFor="company">Empresa</Label>
          <select
            id="company"
            value={companyCode}
            onChange={(event) => setCompanyCode(event.target.value)}
            disabled={pending}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {EMPLOYEE_COMPANIES.map((item) => (
              <option key={item.code} value={item.code}>{item.name}</option>
            ))}
          </select>
        </div>
        <div className={fieldClass}>
          <Label htmlFor="registration">Matrícula</Label>
          <Input id="registration" name="registration" defaultValue={employee?.registration} maxLength={40} required />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" defaultValue={employee?.name} maxLength={180} required />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="admissionDate">Data de admissão</Label>
          <Input id="admissionDate" name="admissionDate" type="date" defaultValue={employee?.admission_date ?? ""} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="dismissalDate">Data de demissão</Label>
          <Input id="dismissalDate" name="dismissalDate" type="date" defaultValue={employee?.dismissal_date ?? ""} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="location">Local de alocação</Label>
          <Input id="location" name="location" defaultValue={employee?.location ?? ""} maxLength={180} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="shift">Turno</Label>
          <Input id="shift" name="shift" defaultValue={employee?.shift ?? ""} maxLength={80} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="area">Área</Label>
          <Input id="area" name="area" defaultValue={employee?.area ?? ""} maxLength={120} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="client">Cliente</Label>
          <Input id="client" name="client" defaultValue={employee?.client ?? ""} maxLength={150} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="responsible1">Líder</Label>
          <Input id="responsible1" name="responsible1" defaultValue={employee?.responsible_1 ?? ""} maxLength={150} />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="responsible2">Encarregado</Label>
          <Input id="responsible2" name="responsible2" defaultValue={employee?.responsible_2 ?? ""} maxLength={150} />
        </div>
        {employee ? (
          <div className={`${fieldClass} justify-self-start`}>
            <Label>Status (automático)</Label>
            <span className={`inline-flex h-9 items-center rounded-full px-3 text-sm font-medium ${employee.dismissal_date ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>
              {employee.dismissal_date ? "Inativo" : "Ativo"}
            </span>
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Salvar funcionário
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/rh/funcionarios"><ArrowLeft className="h-4 w-4" aria-hidden />Voltar para lista</Link>
        </Button>
      </div>
    </form>
  );
}
