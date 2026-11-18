import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/auth/guards";
import { parseEmployeeImportFiles } from "@/lib/import/employee-files";
import { errorMessage } from "@/lib/utils/supabase-result";

export const runtime = "nodejs";

const MAX_SPREADSHEET_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    await requireCapability("rh.manage");
    const form = await request.formData();
    const spreadsheet = form.get("spreadsheet");
    const pdf = form.get("pdf");

    if (!(spreadsheet instanceof File) || spreadsheet.size === 0) {
      return NextResponse.json({ error: "Selecione a planilha de funcionários." }, { status: 400 });
    }
    if (spreadsheet.size > MAX_SPREADSHEET_BYTES) {
      return NextResponse.json({ error: "A planilha excede o limite de 15 MB." }, { status: 413 });
    }
    if (pdf !== null && (!(pdf instanceof File) || pdf.size > MAX_PDF_BYTES)) {
      return NextResponse.json({ error: "O PDF excede o limite de 25 MB ou é inválido." }, { status: 413 });
    }

    const preview = await parseEmployeeImportFiles(
      await spreadsheet.arrayBuffer(),
      pdf instanceof File && pdf.size > 0 ? await pdf.arrayBuffer() : undefined,
    );
    return NextResponse.json(preview);
  } catch (error) {
    const message = errorMessage(error, "Não foi possível analisar os arquivos.");
    const status = /permissão|autorizado|sessão/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
