import { beforeEach, describe, it, expect, vi } from "vitest";
const { rpc, requireUser } = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requireUser }));
import { GET as read } from "../../app/api/subscriptions/route";
import {
  GET as adminRead,
  POST as manage,
} from "../../app/api/admin/trials/route";
beforeEach(() => {
  rpc.mockReset();
  requireUser
    .mockReset()
    .mockResolvedValue({ supabase: { rpc }, user: { id: "user" } });
});
describe("subscription API boundaries", () => {
  it("keeps organization reads scoped, private, and uncached", async () => {
    rpc.mockResolvedValue({ data: { status: "expired", can_write: false } });
    const r = await read(
      new Request("https://qa.local/api/subscriptions?organization_id=test"),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("organization_subscription", {
      p_organization_id: "test",
    });
  });
  it("denies a normal user when server authorization rejects an administrative RPC", async () => {
    rpc.mockResolvedValue({ error: { message: "PLATFORM_OWNER_REQUIRED" } });
    expect(
      (await adminRead(new Request("https://qa.local/api/admin/trials")))
        .status,
    ).toBe(403);
  });
  it("rejects cross-origin mutations before authentication or RPC", async () => {
    const r = await manage(
      new Request("https://qa.local/api/admin/trials", {
        method: "POST",
        headers: { Origin: "https://other.local" },
        body: "{}",
      }),
    );
    expect(r.status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("requires an audit reason and an expected revision", async () => {
    const r = await manage(
      new Request("https://qa.local/api/admin/trials", {
        method: "POST",
        headers: { Origin: "https://qa.local" },
        body: JSON.stringify({ action: "extend", reason: "x" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not accept a client-supplied actor or subscription status", async () => {
    const r = await manage(
      new Request("https://qa.local/api/admin/trials", {
        method: "POST",
        headers: { Origin: "https://qa.local" },
        body: JSON.stringify({
          action: "extend",
          reason: "Approved extension",
          revision: 1,
          status: "active",
          actor: "owner",
        }),
      }),
    );
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
