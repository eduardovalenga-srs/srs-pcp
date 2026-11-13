import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { canMock, createClientMock, getFabrica2FilteredSummaryMock, getSessionUserMock } = vi.hoisted(() => ({
  canMock: vi.fn(),
  createClientMock: vi.fn(),
  getFabrica2FilteredSummaryMock: vi.fn(),
  getSessionUserMock: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ can: canMock }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: getSessionUserMock }));
vi.mock("@/lib/services/production.service", () => ({
  getFabrica2FilteredSummary: getFabrica2FilteredSummaryMock,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { GET } = await import("@/app/api/fabrica-2/summary/route");

beforeEach(() => {
  canMock.mockReset();
  createClientMock.mockReset();
  getFabrica2FilteredSummaryMock.mockReset();
  getSessionUserMock.mockReset();

  getSessionUserMock.mockResolvedValue({ role: "ADMIN" });
  canMock.mockReturnValue(true);
  createClientMock.mockResolvedValue({});
  getFabrica2FilteredSummaryMock.mockResolvedValue({
    overdue: { records: 2, qty: 4, weight: 3.5 },
    acabamento: { records: 1, qty: 1, weight: 0 },
  });
});

describe("GET /api/fabrica-2/summary", () => {
  it("exige sessão", async () => {
    getSessionUserMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/fabrica-2/summary"));

    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("exige a permissão de visualização da Fábrica 2", async () => {
    canMock.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/fabrica-2/summary"));

    expect(response.status).toBe(403);
    expect(canMock).toHaveBeenCalledWith("ADMIN", "fabrica2.view");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("encaminha os filtros e devolve os dois KPIs", async () => {
    const response = await GET(
      new Request("http://localhost/api/fabrica-2/summary?entrega=OVERDUE&procsatrasado=1&of=TT10"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      overdue: { records: 2, qty: 4, weight: 3.5 },
      acabamento: { records: 1, qty: 1, weight: 0 },
    });
    expect(getFabrica2FilteredSummaryMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        delivery: "OVERDUE",
        processOverdue: true,
        processStatus: "ALL",
        orderCode: "TT10",
      }),
    );
  });
});
