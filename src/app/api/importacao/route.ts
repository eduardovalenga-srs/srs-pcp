import { NextResponse } from "next/server";

import { can } from "@/lib/auth/permissions";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import type { OfDecisionMap } from "@/lib/types/import";
import { errorMessage } from "@/lib/utils/supabase-result";
import {
  analyzeWorkbook,
  buildPreview,
  executeImport,
  readFileForImport,
  ImportInputError,
} from "@/lib/services/import.service";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseServer } from "@/lib/supabase/types";
import { firstZodMessage } from "@/lib/validators/common";
import { importDecisionsSchema, importFormSchema } from "@/lib/validators/import.schema";

/**
 * API da importação de planilhas (layout novo — estrutura OF).
 *
 * POST /api/importacao — multipart/form-data com `file`, `step`
 * ("analyze" | "preview" | "execute") e, conforme a etapa, `sheetName`,
 * `customerName`, `deliveryDate` e `decisions` (JSON com a escolha por
 * OF existente: UPDATE | KEEP | SKIP).
 *
 * Nunca redireciona: sem sessão responde 401 e sem a capacidade
 * `import.access` responde 403 (semântica de API). O arquivo é validado e
 * parseado pela camada de serviço com `xlsx` — macros e fórmulas nunca são
 * executadas. Toda a escrita usa o cliente da sessão do usuário (RLS ativa).
 */

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** Autentica e autoriza a ação; devolve 401/403 como JSON quando bloqueado. */
async function authorize(): Promise<{ supabase: SupabaseServer; user: SessionUser } | NextResponse> {
  const supabase = await createClient();
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Sessão expirada. Entre novamente.", 401);
  }
  if (!can(user.role, "import.access")) {
    return jsonError("Seu perfil não tem permissão para importar planilhas.", 403);
  }
  return { supabase, user };
}

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (value === null || value instanceof File) return "";
  return value;
}

/**
 * Revalida o formulário da etapa no servidor (nada vem pronto do
 * cliente): aba, cliente e data de entrega.
 */
function readFormInput(formData: FormData): { sheetName: string; customerName: string; deliveryDate: string } | { error: string } {
  const parsed = importFormSchema.safeParse({
    sheetName: readText(formData, "sheetName").trim(),
    customerName: readText(formData, "customerName").trim(),
    deliveryDate: readText(formData, "deliveryDate").trim(),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue ? `Dados inválidos: ${firstZodMessage(parsed.error)}` : "Dados de importação inválidos." };
  }

  return parsed.data;
}

/** Decisões por OF da etapa de execução (JSON vindo do cliente). */
function readDecisions(formData: FormData): OfDecisionMap | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readText(formData, "decisions") || "{}");
  } catch {
    return { error: "Decisões inválidas. Volte à prévia e tente novamente." };
  }

  const parsed = importDecisionsSchema.safeParse({ decisions: raw });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue ? `Decisões inválidas: ${firstZodMessage(parsed.error)}` : "Decisões inválidas." };
  }

  return parsed.data.decisions as OfDecisionMap;
}

export async function POST(request: Request) {
  let auth: { supabase: SupabaseServer; user: SessionUser } | NextResponse;
  try {
    auth = await authorize();
  } catch (error) {
    // Falha ao montar a sessão (configuração/infraestrutura) — sempre JSON.
    console.error("[api/importacao] authorize", error);
    return jsonError(errorMessage(error, "Não foi possível iniciar a sessão."), 500);
  }
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  let formData: FormData | null = null;
  try {
    formData = await request.formData();
  } catch {
    formData = null;
  }
  if (!formData) {
    return jsonError("Requisição inválida: envie os dados como multipart/form-data.", 400);
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return jsonError("Nenhum arquivo enviado. Selecione uma planilha .xlsx ou .xls.", 400);
  }

  const step = readText(formData, "step");
  if (step !== "analyze" && step !== "preview" && step !== "execute") {
    return jsonError("Etapa de importação inválida.", 400);
  }

  let parsed: { buffer: ArrayBuffer; fileName: string; fileSize: number };
  try {
    parsed = await readFileForImport(fileEntry);
  } catch (error) {
    return jsonError(errorMessage(error, "Não foi possível ler o arquivo."), 400);
  }

  try {
    // Etapa 1: lê o arquivo e identifica as abas no formato reconhecido.
    if (step === "analyze") {
      const analysis = analyzeWorkbook(parsed.buffer, parsed.fileName, parsed.fileSize);
      return NextResponse.json(analysis);
    }

    const form = readFormInput(formData);
    if ("error" in form) return jsonError(form.error, 400);

    // Etapa 2: estrutura hierárquica + diferenças (JSON serializável).
    if (step === "preview") {
      const preview = await buildPreview(supabase, {
        buffer: parsed.buffer,
        fileName: parsed.fileName,
        fileSize: parsed.fileSize,
        ...form,
      });
      return NextResponse.json(preview);
    }

    // Etapa 3: revalida estrutura antes de gravar (erro de entrada -> 400).
    const decisions = readDecisions(formData);
    if ("error" in decisions) return jsonError(decisions.error, 400);

    try {
      const result = await executeImport(supabase, user, {
        buffer: parsed.buffer,
        fileName: parsed.fileName,
        fileSize: parsed.fileSize,
        ...form,
        decisions,
      });
      return NextResponse.json(result);
    } catch (error) {
      // Entrada inválida (aba/estrutura/decisões) -> 400; falha de
      // gravação/transação -> 500. Sempre JSON, nunca redireciona.
      if (error instanceof ImportInputError) {
        return jsonError(error.message, 400);
      }
      console.error("[api/importacao] executeImport", error);
      return jsonError(errorMessage(error, "Não foi possível concluir a importação."), 500);
    }
  } catch (error) {
    return jsonError(errorMessage(error, "Não foi possível processar a planilha."), 400);
  }
}
