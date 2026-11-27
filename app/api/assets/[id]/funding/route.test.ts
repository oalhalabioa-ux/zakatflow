import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { requireUser } from "../../../../../services/auth";

vi.mock("../../../../../services/auth", () => ({ requireUser: vi.fn() }));

const owner = "849ba270-34dd-45ed-9150-a34d53fab501";
const asset = "4ea7c0f7-75d4-487f-a403-ec7523a4d247";
const acquisition = "a6ece91c-d508-4eb5-9cdb-0c9458378817";
const request = "e174abeb-a953-4f77-a5f1-b6228d5bfdeb";
const withdrawal = "d6307114-d445-4dca-ad8a-d7e36068703e";
const evidence = {
  version: 1, withdrawal_id: withdrawal, payment_amount: 100000, payment_currency: "SAR", base_currency: "SAR",
  asset_basis_base: 100000, cash_basis_base: 100000, realized_fx_base: 0,
};

const db = vi.fn();
const filters: unknown[][] = [];
const calls = (rows: (object | null)[]) => {
  for (const data of rows) db.mockImplementationOnce((table: string) => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { filters.push([table, "eq", ...args]); return query; },
      is: (...args: unknown[]) => { filters.push([table, "is", ...args]); return query; },
      maybeSingle: async () => ({ data, error: null }),
    };
    return query;
  });
};

describe("personal asset funding read", () => {
  beforeEach(() => {
    filters.length = 0;
    db.mockReset();
    vi.mocked(requireUser).mockResolvedValue({ supabase: { from: db }, user: { id: owner } } as never);
  });

  function read(id = asset) {
    return GET(new Request("https://example.invalid/api/assets/" + id + "/funding"), { params: Promise.resolve({ id }) });
  }

  it("returns only verified, owner-scoped cash evidence and its recorded reversal", async () => {
    calls([
      { id: asset, metadata: { acquisition_request_id: request } },
      { id: acquisition, metadata: { purchase_funding: evidence } },
      { id: withdrawal, transaction_type: "WITHDRAWAL", transaction_date: "2026-11-27",
        metadata: { source: "ASSET_PURCHASE", purchase_funding: evidence }, reference: "PAY-001" },
      { id: request, transaction_date: "2026-11-28" },
    ]);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ payment: { id: withdrawal, date: "2026-11-27", reference: "PAY-001",
      amount: 100000, currency: "SAR", acquisitionCost: 100000, baseCurrency: "SAR", reversedOn: "2026-11-28" } });
    expect(filters.filter(row => row[2] === "user_id").map(row => row[3])).toEqual([owner, owner, owner, owner]);
    expect(filters.filter(row => row[2] === "organization_id")).toHaveLength(4);
    expect(filters).toContainEqual(["transactions", "eq", "metadata->>purchase_transaction_id", acquisition]);
  });

  it("returns no fabricated payment when an earlier asset has no inquiry evidence", async () => {
    calls([{ id: asset, metadata: {} }]);
    expect(await (await read()).json()).toEqual({ payment: null });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("rejects access to a different scope and invalid identifier before reading transactions", async () => {
    calls([null]);
    expect((await read()).status).toBe(404);
    expect((await read("not-an-asset")).status).toBe(400);
    expect(db).toHaveBeenCalledTimes(1);
  });
});
