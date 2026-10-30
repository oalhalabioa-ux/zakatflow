import { beforeEach, describe, it, expect, vi } from "vitest";
const { rpc, requireUser } = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requireUser }));
import { POST } from "../../app/api/admin/trials/plans/route";
const plan = {
  code: "custom_test",
  family: "custom_test",
  name_ar: "باقة اختبار",
  name_en: "Test plan",
  description_ar: "",
  description_en: "",
  price: 199,
  currency: "SAR",
  interval: "monthly",
  max_users: 5,
  features: ["module:assets", "module:liquidity"],
  is_active: true,
  is_published: false,
  is_proposed: true,
  reason: "Approved plan setup",
};
const request = (body: unknown) =>
  new Request("https://qa.test/api/admin/trials/plans", {
    method: "POST",
    headers: { Origin: "https://qa.test" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  rpc.mockReset();
  requireUser.mockReset().mockResolvedValue({ supabase: { rpc } });
});
describe("plan administration boundary", () => {
  it("requires approved capabilities and does not accept forged actor fields", async () => {
    expect((await POST(request({ ...plan, actor: "owner" }))).status).toBe(400);
    expect((await POST(request({ ...plan, features: ["core"] }))).status).toBe(
      400,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires optimistic revision on edits", async () => {
    expect(
      (
        await POST(
          request({ ...plan, id: "11111111-1111-4111-8111-111111111111" }),
        )
      ).status,
    ).toBe(400);
  });
  it("uses live server owner authorization", async () => {
    rpc.mockResolvedValue({ error: { message: "PLATFORM_OWNER_REQUIRED" } });
    expect((await POST(request(plan))).status).toBe(403);
  });
  it("passes plan details and administrative reason to one audited RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "plan" } });
    expect((await POST(request(plan))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("owner_save_subscription_plan", {
      p_details: expect.objectContaining({
        max_users: 5,
        features: plan.features,
      }),
      p_reason: plan.reason,
    });
  });
});
