"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { IMPORT_DECISION_LABELS, IMPORT_DECISIONS, type ImportDecision } from "@/lib/constants/import";
import { undecidedOrders } from "@/lib/import/of-plan";
import type { AnalyzeOutput, ExecuteImportOutput } from "@/lib/services/import.service";
import type { ImportPreview, OfDecisionMap } from "@/lib/types/import";
import { fileKeyFromBytes, orderCodeFromDateAndFileKey } from "@/lib/utils/order-code";
import { FileDrop } from "@/components/importacao/FileDrop";
import { OfPreviewList } from "@/components/importacao/OfPreviewList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WizardStep = 1 | 2 | 3 | 4;
type BusyAction = "analyze" | "preview" | "execute" | null;
type ApiStep = "analyze" | "preview" | "execute";

const STEP_LABELS = ["Arquivo", "Prévia", "Confirmação", "Resultado"] as const;

interface ImportWizardProps {
  capabilities: {
    canViewOrders: boolean;
    canViewProduction: boolean;
  };
}

interface PostInput {
  step: ApiStep;
  file: File;
  sheetName?: string;
  customerName?: string;
  deliveryDate?: string;
  decisions?: OfDecisionMap;
}

function readErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Não foi possível processar o arquivo.";
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Erro inesperado. Tente novamente.";
}

/** Envia a etapa atual para a API (a validação de verdade acontece no servidor). */
async function postImport(input: PostInput): Promise<unknown> {
  const formData = new FormData();
  formData.set("step", input.step);
  formData.set("file", input.file);
  if (input.sheetName) formData.set("sheetName", input.sheetName);
  if (input.customerName) formData.set("customerName", input.customerName);
  if (input.deliveryDate) formData.set("deliveryDate", input.deliveryDate);
  if (input.decisions) formData.set("decisions", JSON.stringify(input.decisions));

  let response: Response;
  try {
    response = await fetch("/api/importacao", { method: "POST", body: formData });
  } catch {
    throw new Error("Falha de conexão. Verifique sua rede e tente novamente.");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readErrorMessage(data));
  return data;
}

/**
 * Assistente de importação em 4 etapas: arquivo + dados do formulário →
 * prévia hierárquica (com decisões por OF) → confirmação → resultado.
 * Toda a leitura/validação do arquivo é feita no servidor; aqui fica
 * apenas a orquestração da interface.
 */
export function ImportWizard({ capabilities }: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);
  const [file, setFile] = useState<File | null>(null);
  // Chave do arquivo (hash dos bytes) — mesma regra do servidor para o
  // sufixo do código da OF gerado pelas listas de peças.
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeOutput | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<OfDecisionMap>({});
  const [result, setResult] = useState<ExecuteImportOutput | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const activeSheet = sheetName || analysis?.defaultSheet || "";
  const activeFormat = analysis?.sheets.find((sheet) => sheet.name === activeSheet)?.format ?? null;
  const isPartsList = activeFormat === "lista-pecas";
  const isProjectList = activeFormat === "lista-projeto";
  // Código que as listas de peças vão gerar — mesma regra do servidor
  // (dia e mês da entrega + sufixo derivado dos bytes do arquivo).
  const generatedOrderCode =
    (isPartsList || isProjectList) && fileKey && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
      ? orderCodeFromDateAndFileKey(deliveryDate, fileKey).code
      : null;
  const undecided = preview ? undecidedOrders(preview, decisions) : [];
  const canContinue = preview !== null && preview.totals.importable > 0 && undecided.length === 0;
  const existingCodes = preview?.orders.filter((entry) => entry.requiresDecision).map((entry) => entry.order.code) ?? [];

  const fail = (message: string) => {
    setError(message);
    toast.error(message);
  };

  const invalidatePreview = () => {
    setPreview(null);
    setDecisions({});
    setResult(null);
  };

  const analyzeFile = async (target: File): Promise<AnalyzeOutput | null> => {
    try {
      const data = (await postImport({ step: "analyze", file: target })) as AnalyzeOutput;
      setAnalysis(data);
      setSheetName(data.defaultSheet);
      return data;
    } catch (caught) {
      setAnalysis(null);
      setSheetName("");
      fail(readError(caught));
      return null;
    }
  };

  const handleFileChange = async (next: File | null) => {
    setFile(next);
    setAnalysis(null);
    setSheetName("");
    setFileKey(null);
    invalidatePreview();
    setError(null);

    if (!next) {
      setStatus("");
      return;
    }

    // Mesma chave que o servidor deriva dos bytes — habilita a dica do
    // código da OF que as listas de peças vão gerar.
    try {
      setFileKey(fileKeyFromBytes(new Uint8Array(await next.arrayBuffer())));
    } catch {
      setFileKey(null);
    }

    setStatus("Analisando o arquivo…");
    const data = await analyzeFile(next);
    if (data) {
      setStatus(
        data.source === "pdf"
          ? `PDF reconhecido — seção "${data.defaultSheet}" com ${data.sheets[0]?.rowCount ?? 0} conjunto(s).`
          : `Arquivo reconhecido — ${data.sheets.length} aba(s) no formato esperado.`,
      );
      toast.success("Arquivo analisado com sucesso.");
    } else {
      setStatus("");
    }
  };

  const handleSheetChange = (value: string) => {
    if (value === activeSheet) return;
    setSheetName(value);
    invalidatePreview();
    setStatus(`Aba "${value}" selecionada.`);
  };

  const validateForm = (): boolean => {
    if (!customerName.trim()) {
      fail("Informe o nome do cliente.");
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
      fail("Informe a data de entrega.");
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    if (!file) {
      fail("Selecione um arquivo Excel (.xlsx ou .xls) ou PDF da OF.");
      return;
    }
    if (!validateForm()) return;

    setBusy("preview");
    setError(null);
    setStatus("Gerando a prévia da importação…");

    try {
      let sheet = activeSheet;
      if (!analysis) {
        const data = await analyzeFile(file);
        if (!data) return;
        sheet = data.defaultSheet;
      }

      const data = (await postImport({
        step: "preview",
        file,
        sheetName: sheet,
        customerName: customerName.trim(),
        deliveryDate,
      })) as ImportPreview;

      setPreview(data);
      setDecisions({});
      setResult(null);
      setStep(2);
      setStatus(
        `Prévia gerada: ${data.totals.orders} OF(s) — ${data.totals.importable} importável(is), ${data.totals.existing} existente(s).`,
      );
      toast.success("Prévia gerada.");
    } catch (caught) {
      fail(readError(caught));
      setStatus("");
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async () => {
    if (!file || !preview) return;
    if (preview.totals.importable === 0) {
      fail("Nenhuma OF válida para importar. Corrija os erros indicados na prévia.");
      return;
    }
    if (undecided.length > 0) {
      fail(`Informe o que fazer com: ${undecided.map((entry) => entry.order.code).join(", ")}.`);
      return;
    }

    setBusy("execute");
    setError(null);
    setStatus("Importando as OFs…");

    try {
      const data = (await postImport({
        step: "execute",
        file,
        sheetName: preview.sheetName,
        customerName: preview.customerName,
        deliveryDate: preview.deliveryDate,
        decisions,
      })) as ExecuteImportOutput;

      setResult(data);
      setStep(4);
      setStatus(`Importação concluída: ${data.created} criada(s) e ${data.updated} atualizada(s).`);
      toast.success("Importação concluída!");
      // O lote já foi gravado — re-renderiza a página para o histórico
      // de importações (abaixo do assistente) listar o lote novo.
      router.refresh();
    } catch (caught) {
      fail(readError(caught));
      setStatus("");
    } finally {
      setBusy(null);
    }
  };

  const handleBack = () => {
    setError(null);
    setStatus("");
    setStep((current) => (current === 1 ? 1 : ((current - 1) as WizardStep)));
  };

  const handleRestart = () => {
    setStep(1);
    setFile(null);
    setAnalysis(null);
    setSheetName("");
    setCustomerName("");
    setDeliveryDate("");
    setPreview(null);
    setDecisions({});
    setResult(null);
    setError(null);
    setStatus("");
  };

  const applyDecisionToAll = (value: ImportDecision) => {
    if (existingCodes.length === 0) return;
    setDecisions(Object.fromEntries(existingCodes.map((code) => [code, value])));
    setStatus(`Decisão "${IMPORT_DECISION_LABELS[value]}" aplicada a ${existingCodes.length} OF(s).`);
  };

  return (
    <section aria-labelledby="assistente-heading" className="rounded border bg-card p-3 sm:p-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="assistente-heading" className="text-sm font-semibold tracking-tight">
              Assistente de importação
            </h2>
            <p className="text-xs text-muted-foreground">
              O arquivo é analisado no servidor em cada etapa — nada é gravado antes da confirmação.
            </p>
          </div>

          <ol className="flex flex-wrap gap-1.5" aria-label="Etapas da importação">
            {STEP_LABELS.map((label, index) => {
              const stepNumber = (index + 1) as WizardStep;
              const current = step === stepNumber;
              const done = step > stepNumber;

              return (
                <li
                  key={label}
                  aria-current={current ? "step" : undefined}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium ${
                    current
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <span aria-hidden>{done ? <Check className="h-3.5 w-3.5" /> : stepNumber}</span>
                  <span>
                    {index + 1}. {label}
                  </span>
                  <span className="sr-only">
                    {current ? "(etapa atual)" : done ? "(concluída)" : "(pendente)"}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Etapa 1 — arquivo + dados do formulário */}
        {step === 1 ? (
          <div className="space-y-4">
            <FileDrop file={file} onChange={(next) => void handleFileChange(next)} disabled={busy !== null} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="importacao-cliente">Cliente *</Label>
                <Input
                  id="importacao-cliente"
                  value={customerName}
                  onChange={(event) => {
                    setCustomerName(event.target.value);
                    invalidatePreview();
                  }}
                  placeholder="Nome do cliente que receberá o pedido"
                  maxLength={160}
                  disabled={busy !== null}
                  aria-invalid={Boolean(error) && !customerName.trim()}
                />
                <p className="text-xs text-muted-foreground">
                  Digitado agora (nem a planilha nem o PDF trazem o cliente). Vale para todas as OFs do arquivo.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="importacao-entrega">Data de entrega *</Label>
                <Input
                  id="importacao-entrega"
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => {
                    setDeliveryDate(event.target.value);
                    invalidatePreview();
                  }}
                  disabled={busy !== null}
                  aria-invalid={Boolean(error) && !deliveryDate}
                />
                <p className="text-xs text-muted-foreground">
                  {generatedOrderCode
                    ? `Vinculada a todos os registros. Nesta lista o código da OF é gerado da entrega + sufixo do arquivo: ${generatedOrderCode}.`
                    : "Vinculada a todos os registros: OF, itens pai e filhos."}
                </p>
              </div>
            </div>

            {analysis && analysis.sheets.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="importacao-aba">
                  {analysis.source === "pdf" ? "Seção do PDF" : "Aba da planilha"}
                </Label>
                <Select value={activeSheet} onValueChange={handleSheetChange} disabled={busy !== null}>
                  <SelectTrigger id="importacao-aba" className="w-[280px]">
                    <SelectValue placeholder="Selecione a aba" />
                  </SelectTrigger>
                  <SelectContent>
                    {analysis.sheets.map((sheet) => (
                      <SelectItem key={sheet.name} value={sheet.name}>
                        {sheet.name} ({sheet.rowCount} linhas)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {analysis ? (
              <p className="text-xs text-muted-foreground">
                {analysis.fileName} ·{" "}
                {analysis.source === "pdf"
                  ? `seção "${activeSheet}" (COMPOSIÇÃO DOS CONJUNTOS) · ${
                      analysis.sheets[0]?.rowCount ?? 0
                    } conjunto(s) lidos`
                  : `${activeSheet} · ${
                      analysis.sheets.find((sheet) => sheet.name === activeSheet)?.columnCount ?? 0
                    } coluna(s) · ${
                      isPartsList
                        ? "lista de peças e conjuntos"
                        : isProjectList
                          ? "lista de peças do projeto"
                          : "layout técnico da fábrica"
                    } · cabeçalho detectado automaticamente`}
              </p>
            ) : null}

            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Planilha (.xlsx): o modelo traz o cabeçalho técnico e linhas de exemplo da hierarquia.</li>
              <li>
                Lista de peças e conjuntos (.xlsx): colunas CONJUNTO, PEÇA, QTDE, PERFIL, MATERIAL e MASSA(Kg) —
                conjuntos viram itens pai, peças viram filhos; o código da OF é gerado da data de entrega + sufixo
                derivado do arquivo.
              </li>
              <li>
                Lista de peças do projeto (.xlsx): colunas GT/MD, PEÇA, CÓDIGO DA PEÇA, PEÇA PRINCIPAL, QUANTIDADE
                EM PROJETO e MASSA TOTAL DO PROJETO (KG) — cada grupo GT/MD (escada/torre) vira item pai, cada
                peça vira filho com a PEÇA PRINCIPAL como matéria-prima; o código da OF segue a mesma regra da
                lista de peças (entrega + sufixo do arquivo).
              </li>
              <li>
                PDF (.pdf): a seção <strong>COMPOSIÇÃO DOS CONJUNTOS</strong> da Ordem de Fabricação da A1 vira a
                estrutura — conjuntos são itens pai, peças são filhos, perfis/chapas viram matéria-prima.
              </li>
              <li>Não existe etapa de mapeamento: as colunas são reconhecidas pelo nome.</li>
              <li>A prévia mostra a estrutura, erros/alertas e as diferenças por OF — nada é gravado antes da confirmação.</li>
            </ul>
          </div>
        ) : null}

        {/* Etapa 2 — prévia hierárquica + decisões por OF */}
        {step === 2 && preview ? (
          <div className="space-y-3">
            {existingCodes.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2 rounded border bg-muted/30 p-2">
                <span className="text-xs font-medium">
                  {existingCodes.length} OF(s) já existem no sistema:
                </span>
                <Select onValueChange={(value) => applyDecisionToAll(value as ImportDecision)} disabled={busy !== null}>
                  <SelectTrigger className="w-[240px]" aria-label="Aplicar decisão a todas as OFs existentes">
                    <SelectValue placeholder="Aplicar decisão a todas" />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORT_DECISIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {IMPORT_DECISION_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <OfPreviewList
              preview={preview}
              decisions={decisions}
              onDecisionChange={(code, decision) =>
                setDecisions((previous) => ({ ...previous, [code]: decision }))
              }
              disabled={busy !== null}
            />

            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">{preview.totals.importable}</strong> OF(s) importável(is) de{" "}
              <strong className="text-foreground">{preview.totals.orders}</strong> ·{" "}
              {preview.totals.parents} itens pai · {preview.totals.children} filhos · {preview.totals.materials}{" "}
              matéria(s)-prima · {preview.totals.errors} OF(s) com erro · {preview.totals.warnings} com alerta
              {preview.ignoredColumns.length > 0
                ? ` · ${preview.ignoredColumns.length} coluna(s) ignoradas (obra/área/desenhos)`
                : ""}
              .
            </p>
            {undecided.length > 0 ? (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                Escolha o que fazer com {undecided.length} OF(s) existente(s) para continuar.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Etapa 3 — confirmação */}
        {step === 3 && preview ? (
          <div className="space-y-4">
            <div className="rounded border bg-muted/30 p-3 text-sm">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Arquivo:</dt>
                  <dd className="font-medium">{file?.name ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Origem:</dt>
                  <dd className="font-medium">{preview.sheetName}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Cliente:</dt>
                  <dd className="font-medium">{preview.customerName}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Entrega:</dt>
                  <dd className="font-medium tabular-nums">
                    {preview.deliveryDate.split("-").reverse().join("/")}
                  </dd>
                </div>
              </dl>
            </div>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "A criar", value: preview.orders.filter((entry) => !entry.exists && entry.status !== "ERROR").length },
                { label: "A atualizar", value: Object.values(decisions).filter((value) => value === "UPDATE").length },
                { label: "Manter", value: Object.values(decisions).filter((value) => value === "KEEP").length },
                { label: "Ignorar", value: Object.values(decisions).filter((value) => value === "SKIP").length },
                { label: "Itens pai", value: preview.totals.parents },
                { label: "Filhos", value: preview.totals.children },
              ].map((entry) => (
                <div key={entry.label} className="rounded border bg-muted/30 p-2">
                  <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{entry.value}</dd>
                </div>
              ))}
            </dl>

            <p className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Nada é gravado antes desta confirmação. OFs com erro ficam de fora e ficam registradas no histórico;
              em OFs atualizadas, os status dos processos e a OP dos itens que permanecem são preservados.
            </p>
          </div>
        ) : null}

        {/* Etapa 4 — resultado */}
        {step === 4 && result ? (
          <div className="space-y-4">
            <div
              role="status"
              className="rounded border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary"
            >
              Importação concluída — lote registrado no histórico.
            </div>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "OFs no arquivo", value: result.total },
                { label: "OFs criadas", value: result.created },
                { label: "OFs atualizadas", value: result.updated },
                { label: "OFs ignoradas", value: result.skipped },
                { label: "Erros", value: result.errors },
                { label: "Alertas", value: result.warnings },
                { label: "Pais criados", value: result.parentsCreated },
                { label: "Pais atualizados", value: result.parentsUpdated },
                { label: "Filhos criados", value: result.childrenCreated },
                { label: "Filhos atualizados", value: result.childrenUpdated },
                { label: "Itens removidos", value: result.itemsRemoved },
                { label: "Lote", value: "—" },
              ].map((entry) => (
                <div key={entry.label} className="rounded border bg-muted/30 p-2">
                  <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {entry.label === "Lote" ? (
                      <span className="block truncate font-mono text-xs" title={result.batchId}>
                        {result.batchId.slice(0, 8)}…
                      </span>
                    ) : (
                      entry.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              {capabilities.canViewOrders ? (
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link href="/pedidos">Ver pedidos</Link>
                </Button>
              ) : null}
              {capabilities.canViewProduction ? (
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link href="/gestao-entregas">Ver gestão de OF</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {status}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div>
          {step > 1 && !result ? (
            <Button type="button" variant="outline" onClick={handleBack} disabled={busy !== null}>
              <ArrowLeft aria-hidden />
              Voltar
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {step === 1 ? (
            <Button type="button" onClick={() => void handlePreview()} disabled={busy !== null || !file}>
              {busy === "preview" ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
              {busy === "preview" ? "Gerando prévia…" : "Gerar prévia"}
            </Button>
          ) : null}

          {step === 2 ? (
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setStatus("");
                setStep(3);
              }}
              disabled={busy !== null || !canContinue}
            >
              Continuar para confirmação
              <ArrowRight aria-hidden />
            </Button>
          ) : null}

          {step === 3 && !result ? (
            <Button type="button" onClick={() => void handleConfirm()} disabled={busy !== null || !canContinue}>
              {busy === "execute" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {busy === "execute" ? "Importando…" : "Confirmar importação"}
            </Button>
          ) : null}

          {step === 4 && result ? (
            <Button type="button" variant="outline" onClick={handleRestart}>
              <Plus aria-hidden />
              Nova importação
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
