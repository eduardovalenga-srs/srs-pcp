"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { importEmployeesAction } from "@/lib/actions/employees.actions";
import type { EmployeeImportPreview } from "@/lib/import/employee-files";
import { employeeImportKey } from "@/lib/utils/employee-import";
import { Button } from "@/components/ui/button";

export function EmployeeImport() {
  const router = useRouter();
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null);
  const [error, setError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, startImport] = useTransition();
  const discrepancyKeys = new Set(preview?.discrepancies.map((item) => item.key) ?? []);
  const rowsWithoutDiscrepancies = preview?.rows.filter(
    (row) => !discrepancyKeys.has(employeeImportKey(row.company_code, row.registration)),
  ) ?? [];

  async function analyze(formData: FormData) {
    setError("");
    setPreview(null);
    const spreadsheet = formData.get("spreadsheet");
    if (!(spreadsheet instanceof File) || spreadsheet.size === 0) {
      setError("Selecione a planilha de funcionários.");
      return;
    }
    setIsParsing(true);
    try {
      const response = await fetch("/api/rh/funcionarios/importacao", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível analisar os arquivos.");
      setPreview(body as EmployeeImportPreview);
      toast.success("Prévia da importação pronta.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Não foi possível analisar os arquivos.";
      setError(message);
      toast.error(message);
    } finally {
      setIsParsing(false);
    }
  }

  function importRows(includeDiscrepancies: boolean) {
    if (!preview || isImporting) return;
    const discrepancyKeys = new Set(preview.discrepancies.map((item) => item.key));
    const rows = includeDiscrepancies
      ? preview.rows
      : preview.rows.filter(
          (row) => !discrepancyKeys.has(employeeImportKey(row.company_code, row.registration)),
        );
    if (rows.length === 0) {
      setError("Não há funcionários para importar após ignorar as divergências.");
      return;
    }
    startImport(async () => {
      const result = await importEmployeesAction(rows);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.push("/rh/funcionarios");
    });
  }

  return (
    <section className="space-y-5">
      <form action={analyze} className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <div>
          <h2 className="font-semibold">Arquivos de origem</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A planilha é a fonte das datas. O PDF da folha complementa Cliente Cadastrado (Departamento)
            e Função Cadastrada (Função). Antes de importar, serão sinalizados funcionários ausentes em
            um dos arquivos e matrículas com nomes divergentes. Datas em branco não apagam datas já cadastradas.
          </p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Planilha de funcionários (.xls ou .xlsx) — obrigatória</span>
          <span className="flex items-center gap-2 rounded-md border border-dashed p-3 text-muted-foreground">
            <FileSpreadsheet className="h-5 w-5 shrink-0" aria-hidden />
            <input name="spreadsheet" type="file" accept=".xls,.xlsx" required className="min-w-0 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5" />
          </span>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Listagem da folha (.pdf) — opcional</span>
          <span className="flex items-center gap-2 rounded-md border border-dashed p-3 text-muted-foreground">
            <FileUp className="h-5 w-5 shrink-0" aria-hidden />
            <input name="pdf" type="file" accept=".pdf,application/pdf" className="min-w-0 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5" />
          </span>
        </label>
        <Button type="submit" disabled={isParsing}>
          {isParsing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          Analisar arquivos
        </Button>
      </form>

      {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

      {preview ? (
        <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden />
            <div>
              <h2 className="font-semibold">Prévia dos registros</h2>
              <p className="text-sm text-muted-foreground">
                {preview.rows.length} funcionários considerados: {preview.spreadsheetRows} da planilha,
                {" "}{preview.pdfRows} do PDF e {preview.matchedRows} correspondidos por matrícula e nome.
              </p>
            </div>
          </div>
          {preview.warnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              <p className="mb-1 font-medium">Atenção</p>
              <ul className="list-inside list-disc space-y-1">
                {preview.warnings.slice(0, 20).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                {preview.warnings.length > 20 ? <li>Mais {preview.warnings.length - 20} divergência(s).</li> : null}
              </ul>
            </div>
          ) : null}
          {preview.discrepancies.length > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              <div>
                <p className="font-medium">
                  {preview.discrepancies.length} divergência(s) entre os arquivos
                </p>
                <p>
                  Escolha se deseja importar esses registros mesmo assim ou ignorá-los. Em matrículas
                  com nomes diferentes, os dados do PDF não serão associados ao funcionário.
                  Registros somente no PDF não têm datas de admissão/demissão.
                </p>
              </div>
              <div className="max-h-56 overflow-auto rounded border border-amber-700/20">
                <table className="w-full min-w-[620px] text-left">
                  <thead className="sticky top-0 bg-amber-100 dark:bg-amber-950">
                    <tr>
                      <th className="p-2">Empresa</th>
                      <th className="p-2">Matrícula</th>
                      <th className="p-2">Funcionário</th>
                      <th className="p-2">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.discrepancies.map((item) => (
                      <tr key={`${item.key}:${item.reason}`} className="border-t border-amber-700/20">
                        <td className="p-2">{item.company_code}</td>
                        <td className="p-2">{item.registration}</td>
                        <td className="p-2">
                          {item.name}
                          {item.otherName ? <div>PDF: {item.otherName}</div> : null}
                        </td>
                        <td className="p-2">
                          {item.reason === "SOMENTE_PLANILHA"
                            ? "Somente na planilha"
                            : item.reason === "SOMENTE_PDF"
                              ? "Somente no PDF"
                              : "Nomes divergentes"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : preview.pdfRows > 0 ? (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
              Nenhuma divergência encontrada entre os funcionários dos arquivos.
            </p>
          ) : null}
          <div className="max-h-96 overflow-auto rounded border">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-2">Origem</th><th className="p-2">Empresa</th><th className="p-2">Matrícula</th>
                  <th className="p-2">Nome</th><th className="p-2">Admissão</th><th className="p-2">Demissão</th><th className="p-2">Cliente Cadastrado</th>
                  <th className="p-2">Função Cadastrada</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.company_code}:${row.registration}`} className="border-t">
                    <td className="p-2">{row.source}</td>
                    <td className="p-2">{row.company_code}</td>
                    <td className="p-2">{row.registration}</td>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.admission_date ?? "—"}</td>
                    <td className="p-2">{row.dismissal_date ?? "—"}</td>
                    <td className="p-2">{row.registered_client ?? "—"}</td>
                    <td className="p-2">{row.registered_function ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.discrepancies.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => importRows(true)} disabled={isImporting || preview.rows.length === 0}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                Importar incluindo divergências ({preview.rows.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => importRows(false)}
                disabled={isImporting || rowsWithoutDiscrepancies.length === 0}
              >
                Ignorar divergências e importar ({rowsWithoutDiscrepancies.length})
              </Button>
            </div>
          ) : (
            <Button type="button" onClick={() => importRows(false)} disabled={isImporting || preview.rows.length === 0}>
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              Confirmar importação ({preview.rows.length})
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
