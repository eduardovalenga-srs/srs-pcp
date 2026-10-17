import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { POST } from "@/app/api/importacao/route";
import { GET as getModelo } from "@/app/api/importacao/modelo/route";
import { detectHeaderRow } from "@/lib/import/excel-parser";
import type { ExistingOfStructure } from "@/lib/types/import";

/**
 * API da importação (novo layout): sem sessão 401, sem capacidade 403,
 * entrada inválida 400 e falha de gravação 500 (com lote FALHOU).
 * A escrita passa pelas repositórios mockados — nenhum banco real.
 */

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

const { sessionMock, findOrderStructuresMock, applyOfPlanMock, createBatchMock, insertBatchErrorsMock, completeBatchMock } =
  vi.hoisted(() => ({
    sessionMock: { user: null as { id: string; role: string; name: string } | null },
    findOrderStructuresMock: vi.fn(),
    applyOfPlanMock: vi.fn(),
    createBatchMock: vi.fn(),
    insertBatchErrorsMock: vi.fn(),
    completeBatchMock: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionMock.user,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
}));

vi.mock("@/lib/repositories/orders.repository", () => ({
  findOrderStructures: findOrderStructuresMock,
}));

vi.mock("@/lib/repositories/import.repository", () => ({
  applyOfPlan: applyOfPlanMock,
  createBatch: createBatchMock,
  insertBatchErrors: insertBatchErrorsMock,
  completeBatch: completeBatchMock,
}));

const TECH_HEADERS = [
  "OF_TIPO",
  "of_idOF",
  "of_Descr",
  "ps_idPos",
  "ps_Descr",
  "ps_Tipo",
  "ps_Qtde",
  "ps_Peso",
  "pos_PesoTotal",
  "ps_idMat",
  "ps_DesMaterial",
  "ps_Qualidade",
  "cp_comp",
  "cp_compdescr",
  "cp_compqtdetotal",
  "cp_comppeso",
  "cp_comppesototal",
  "co_compcodmat",
  "cp_DesMaterial",
  "cp_Qualidade",
];

/** Cabeçalho da lista de peças e conjuntos de cliente (038). */
const PARTS_HEADERS = ["CONJUNTO", "PEÇA", "QTDE", "PERFIL", "MATERIAL", "COMPR.(mm)", "MASSA(Kg)"];

const FORM = { sheetName: "Fábrica", customerName: "ACME", deliveryDate: "2026-12-15" };

const PDF_FIXTURE_PATH = path.join(process.cwd(), "tests", "fixtures", "of-2615-aa-4.pdf");

function workbookBytes(sheets: Record<string, unknown[][]>): Uint8Array<ArrayBuffer> {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array<ArrayBuffer>;
}

/** Arquivo no formato da fábrica: título + rótulos + cabeçalho técnico + dados. */
function factoryFile(): File {
  const bytes = workbookBytes({
    Fábrica: [
      ["Relatório da Fábrica"],
      ["Grupo 1", "Grupo 2"],
      TECH_HEADERS,
      ["OF", "107482", "GUARDA CORPO", "72ST18-018", "GUARDA CORPO", "E", 1, 12.48, 12.48, "00000", "SEM MATERIAL", null, "72-742", "GUARDA CORPO", 3, 4.16, 12.48, "T1318", "TB42.20X3.56", "SCH40"],
      // ps_Tipo = X: a linha é descartada na importação (qualquer descrição).
      ["OF", "107482", "GUARDA CORPO", "72ST18-025", "BOTÃO DE PORTA", "X", 2, 1.09, 2.18, "T1318", "TB42.20X3.56", "SCH40", null, null, null, null, null, null, null, null],
    ],
  });
  return new File([bytes], "OF 107482.xlsx");
}

function postForm(fields: Record<string, string | File>): Promise<Response> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return POST(new Request("http://localhost/api/importacao", { method: "POST", body: formData }));
}

function existingStructure(): ExistingOfStructure {
  return {
    id: "order-1",
    code: "OF 107482",
    type: "OF",
    customerName: "Cliente Antigo",
    description: null,
    deliveryDate: "2026-11-30",
    status: "PLANEJADO",
    items: [],
  };
}

beforeEach(() => {
  sessionMock.user = { id: "user-1", role: "GESTOR", name: "Gestor" };
  findOrderStructuresMock.mockReset().mockResolvedValue(new Map());
  applyOfPlanMock.mockReset().mockResolvedValue({
    ordersCreated: 1,
    ordersUpdated: 0,
    ordersSkipped: 0,
    parentsCreated: 1,
    parentsUpdated: 0,
    childrenCreated: 1,
    childrenUpdated: 0,
    itemsRemoved: 0,
  });
  createBatchMock.mockReset().mockResolvedValue("batch-1");
  insertBatchErrorsMock.mockReset().mockResolvedValue(undefined);
  completeBatchMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/importacao — autenticação e entrada", () => {
  it("responde 401 sem sessão", async () => {
    sessionMock.user = null;
    const response = await postForm({ file: factoryFile(), step: "analyze" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sessão expirada. Entre novamente." });
  });

  it("responde 403 para perfil sem import.access", async () => {
    sessionMock.user = { id: "op-1", role: "OPERADOR", name: "Operador" };
    const response = await postForm({ file: factoryFile(), step: "analyze" });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/não tem permissão/);
  });

  it("responde 400 sem arquivo e com etapa inválida", async () => {
    const semArquivo = await postForm({ step: "analyze" });
    expect(semArquivo.status).toBe(400);
    expect((await semArquivo.json()).error).toMatch(/Nenhum arquivo enviado/);

    const etapaErrada = await postForm({ file: factoryFile(), step: "etapa-x" });
    expect(etapaErrada.status).toBe(400);
    expect((await etapaErrada.json()).error).toMatch(/Etapa de importação inválida/);
  });

  it("responde 400 para extensão não suportada", async () => {
    const txt = new File([new Uint8Array([1])], "arquivo.txt");
    const response = await postForm({ file: txt, step: "analyze" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Formato de arquivo não suportado/);
  });
});

describe("POST /api/importacao — etapa analyze", () => {
  it("devolve as abas no formato reconhecido", async () => {
    const response = await postForm({ file: factoryFile(), step: "analyze" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fileName).toBe("OF 107482.xlsx");
    expect(body.defaultSheet).toBe("Fábrica");
    expect(body.sheets).toEqual([
      { name: "Fábrica", rowCount: 2, columnCount: 20, format: "layout-of" },
    ]);
  });

  it("reconhece a lista de peças e conjuntos (formato do cliente)", async () => {
    const bytes = workbookBytes({
      Planilha1: [PARTS_HEADERS, ["SOL-PAS-GC1", null, 2, "GUARDA-CORPO", null, null, 120.4]],
    });
    const response = await postForm({ file: new File([bytes], "lista.xlsx"), step: "analyze" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.defaultSheet).toBe("Planilha1");
    expect(body.sheets).toEqual([
      { name: "Planilha1", rowCount: 1, columnCount: 7, format: "lista-pecas" },
    ]);
  });

  it("rejeita arquivo no formato antigo (sem cabeçalho técnico)", async () => {
    const bytes = workbookBytes({
      Antigo: [
        ["OF/OS", "Cliente", "Data entrega"],
        ["107482", "ACME", "15/12/2026"],
      ],
    });
    const response = await postForm({ file: new File([bytes], "antigo.xlsx"), step: "analyze" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/não contém nenhuma aba no formato reconhecido/);
  });

  it("rejeita cabeçalho com colunas obrigatórias ausentes", async () => {
    const parcial = TECH_HEADERS.filter((header) => header !== "cp_comp");
    const bytes = workbookBytes({
      Fábrica: [
        ["Relatório"],
        parcial,
        ["OF", "107482", "GUARDA CORPO", "72ST18-018", "GUARDA CORPO", "E", 1, 12.48, 12.48],
      ],
    });
    const response = await postForm({ file: new File([bytes], "parcial.xlsx"), step: "analyze" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Colunas obrigatórias ausentes.*cp_comp/);
  });

  it("despacha por extensão: .pdf vira a pseudo-aba de composição", async () => {
    const pdf = readFileSync(PDF_FIXTURE_PATH);
    const file = new File(
      [new Uint8Array(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength))],
      "OF 2615-AA-4.pdf",
      { type: "application/pdf" },
    );
    const response = await postForm({ file, step: "analyze" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("pdf");
    expect(body.sheets).toEqual([
      { name: "Composição dos conjuntos", rowCount: 77, columnCount: 9, format: null },
    ]);
    expect(body.defaultSheet).toBe("Composição dos conjuntos");
  });

  it("PDF ilegível devolve erro amigável (400)", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "of-quebrado.pdf", {
      type: "application/pdf",
    });
    const response = await postForm({ file, step: "analyze" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/PDF legível|PDF da A1/);
  });
});

describe("POST /api/importacao — etapa preview", () => {
  it("monta a prévia com cliente/entrega do formulário e sem conflito", async () => {
    const response = await postForm({ file: factoryFile(), step: "preview", ...FORM });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.customerName).toBe(FORM.customerName);
    expect(body.deliveryDate).toBe(FORM.deliveryDate);
    expect(body.totals).toMatchObject({
      orders: 1,
      importable: 1,
      existing: 0,
      errors: 0,
      parents: 1,
      children: 1,
      materials: 1,
    });

    const entry = body.orders[0];
    expect(entry.status).toBe("VALID");
    expect(entry.exists).toBe(false);
    expect(entry.requiresDecision).toBe(false);
    expect(entry.order.code).toBe("OF 107482");
    expect(entry.order.customerName).toBe(FORM.customerName);
    expect(entry.order.deliveryDate).toBe(FORM.deliveryDate);
    expect(entry.counts).toEqual({ parents: 1, children: 1, materials: 1 });
  });

  it("aponta a OF existente como exigindo decisão", async () => {
    findOrderStructuresMock.mockResolvedValue(new Map([["OF 107482", existingStructure()]]));
    const response = await postForm({ file: factoryFile(), step: "preview", ...FORM });
    const body = await response.json();

    const entry = body.orders[0];
    expect(entry.exists).toBe(true);
    expect(entry.existingStatus).toBe("PLANEJADO");
    expect(entry.requiresDecision).toBe(true);
    expect(entry.differences.length).toBeGreaterThan(0);
    expect(body.totals.existing).toBe(1);
  });

  it("monta a prévia da lista de peças com OF gerada da data de entrega", async () => {
    const bytes = workbookBytes({
      Planilha1: [
        PARTS_HEADERS,
        ["SOL-PAS-GC1", null, 2, "GUARDA-CORPO", null, null, 13.02],
        [null, "P113", 1, "TB. RED. 42,2X3,56", "DIN 2440", 260, 0.91],
        [null, "P194", 10, "BARRA22X3.2", "A36", 995, 0.56],
      ],
    });
    const response = await postForm({
      file: new File([bytes], "lista.xlsx"),
      step: "preview",
      sheetName: "Planilha1",
      customerName: "VIA RONDON",
      deliveryDate: "2026-11-05",
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.totals).toMatchObject({
      orders: 1,
      importable: 1,
      errors: 0,
      parents: 1,
      children: 2,
      materials: 2,
    });
    const entry = body.orders[0];
    expect(entry.status).toBe("VALID");
    expect(entry.exists).toBe(false);
    expect(entry.order.code).toBe("OF 0511");
    expect(entry.order.type).toBe("OF");
    expect(entry.order.customerName).toBe("VIA RONDON");
    expect(entry.order.description).toBe("GUARDA-CORPO");
    expect(entry.counts).toEqual({ parents: 1, children: 2, materials: 2 });
  });

  it("valida cliente e data de entrega no servidor", async () => {
    const semCliente = await postForm({
      file: factoryFile(),
      step: "preview",
      sheetName: "Fábrica",
      customerName: "",
      deliveryDate: FORM.deliveryDate,
    });
    expect(semCliente.status).toBe(400);
    expect((await semCliente.json()).error).toMatch(/Informe o nome do cliente/);

    const dataErrada = await postForm({
      file: factoryFile(),
      step: "preview",
      ...FORM,
      deliveryDate: "15/12/2026",
    });
    expect(dataErrada.status).toBe(400);
    expect((await dataErrada.json()).error).toMatch(/data de entrega válida/);
  });
});

describe("POST /api/importacao — etapa execute", () => {
  it("exige decisão para OF existente (400, nada gravado)", async () => {
    findOrderStructuresMock.mockResolvedValue(new Map([["OF 107482", existingStructure()]]));
    const response = await postForm({
      file: factoryFile(),
      step: "execute",
      ...FORM,
      decisions: "{}",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Informe o que fazer com a OF OF 107482/);
    expect(createBatchMock).not.toHaveBeenCalled();
    expect(applyOfPlanMock).not.toHaveBeenCalled();
  });

  it("grava OF nova sem decisão (CREATE) e registra o lote", async () => {
    const response = await postForm({
      file: factoryFile(),
      step: "execute",
      ...FORM,
      decisions: "{}",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: "batch-1",
      total: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      errors: 0,
      parentsCreated: 1,
      childrenCreated: 1,
      itemsRemoved: 0,
    });

    expect(createBatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ totalRows: 1, validRows: 1, errorRows: 0 }),
    );
    expect(applyOfPlanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operations: [expect.objectContaining({ action: "CREATE" })],
      }),
    );
    expect(completeBatchMock).toHaveBeenCalledWith(expect.anything(), "batch-1", {
      status: "CONCLUIDO",
      validRows: 1,
    });
  });

  it("aplica decisão UPDATE da OF existente", async () => {
    findOrderStructuresMock.mockResolvedValue(new Map([["OF 107482", existingStructure()]]));
    applyOfPlanMock.mockResolvedValue({
      ordersCreated: 0,
      ordersUpdated: 1,
      ordersSkipped: 0,
      parentsCreated: 0,
      parentsUpdated: 1,
      childrenCreated: 1,
      childrenUpdated: 0,
      itemsRemoved: 1,
    });

    const response = await postForm({
      file: factoryFile(),
      step: "execute",
      ...FORM,
      decisions: JSON.stringify({ "OF 107482": "UPDATE" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ created: 0, updated: 1, parentsUpdated: 1, itemsRemoved: 1 });
    expect(applyOfPlanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operations: [expect.objectContaining({ action: "UPDATE" })],
      }),
    );
  });

  it("decisão KEEP não envia estrutura", async () => {
    findOrderStructuresMock.mockResolvedValue(new Map([["OF 107482", existingStructure()]]));
    applyOfPlanMock.mockResolvedValue({
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 1,
      parentsCreated: 0,
      parentsUpdated: 0,
      childrenCreated: 0,
      childrenUpdated: 0,
      itemsRemoved: 0,
    });

    const response = await postForm({
      file: factoryFile(),
      step: "execute",
      ...FORM,
      decisions: JSON.stringify({ "OF 107482": "KEEP" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toBe(1);
    expect(applyOfPlanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operations: [expect.objectContaining({ action: "KEEP", parents: [] })],
      }),
    );
  });

  it("falha de gravação responde 500 e marca o lote como FALHOU", async () => {
    applyOfPlanMock.mockRejectedValue(new Error("Falha na gravação: rpc"));
    const response = await postForm({
      file: factoryFile(),
      step: "execute",
      ...FORM,
      decisions: "{}",
    });

    expect(response.status).toBe(500);
    // 500 saneado (auditoria): mensagem genérica para o cliente —
    // o detalhe da falha só aparece no log do servidor.
    expect((await response.json()).error).toBe("Não foi possível concluir a importação.");
    expect(completeBatchMock).toHaveBeenCalledWith(expect.anything(), "batch-1", {
      status: "FALHOU",
      validRows: 0,
    });
  });

  it("decisão inválida responde 400", async () => {
    findOrderStructuresMock.mockResolvedValue(new Map([["OF 107482", existingStructure()]]));
    const response = await postForm({
      file: factoryFile(),
      step: "execute",
      ...FORM,
      decisions: JSON.stringify({ "OF 107482": "APAGAR" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Decisões inválidas/);
    expect(applyOfPlanMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/importacao/modelo", () => {
  it("exige sessão e capacidade", async () => {
    sessionMock.user = null;
    const semSessao = await getModelo();
    expect(semSessao.status).toBe(401);

    sessionMock.user = { id: "op-1", role: "OPERADOR", name: "Operador" };
    const semPermissao = await getModelo();
    expect(semPermissao.status).toBe(403);
  });

  it("gera o modelo com rótulos + nomes técnicos detectáveis e abas de instrução", async () => {
    const response = await getModelo();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/spreadsheetml/);
    expect(response.headers.get("Content-Disposition")).toMatch(/modelo-importacao-of\.xlsx/);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const workbook = XLSX.read(bytes, { type: "array" });
    expect(workbook.SheetNames).toEqual(["MODELO", "INSTRUÇÕES"]);

    const sheet = workbook.Sheets["MODELO"];
    expect(sheet).toBeDefined();
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, blankrows: false });

    // 1ª linha = rótulos, 2ª = nomes técnicos (é dela que a API detecta).
    expect(matrix[0]?.[1]).toBe("Código OF");
    expect(matrix[1]?.[1]).toBe("of_idOF");
    const detection = detectHeaderRow(matrix);
    expect(detection).toMatchObject({ headerRowIndex: 1, detected: true });

    // 3 linhas de exemplo (pai com 2 filhos + linha sem filhos com material direto).
    expect(matrix).toHaveLength(5);
  });
});
