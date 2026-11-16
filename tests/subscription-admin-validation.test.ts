import { beforeEach, describe, it, expect, vi } from "vitest";
const { rpc, requireUser } = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("../services/auth", () => ({ requireUser }));
vi.mock("@/services/auth", () => ({ requireUser }));
import { POST } from "../app/api/admin/trials/route";
import { subscriptionError } from "../lib/subscriptions/model";
import { adminSubscriptionError } from "../lib/subscriptions/admin-errors";
const organization = "11111111-1111-4111-8111-111111111111",
  plan = "22222222-2222-4222-8222-222222222222";
const request = (body: Record<string, unknown>) =>
  new Request("https://app.yaqeenbiz.com/api/admin/trials", {
    method: "POST",
    headers: {
      Origin: "https://app.yaqeenbiz.com",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { revision: 1 }, error: null });
  requireUser.mockReset().mockResolvedValue({ supabase: { rpc } });
});
describe("owner subscription activation input", () => {
  it.each([undefined, null, "", "not-a-uuid"])(
    "rejects an absent or invalid plan (%s) before the database call",
    async (plan_id) => {
      const response = await POST(
        request({
          action: "activate",
          reason: "Approved manual activation",
          organization_id: organization,
          revision: 0,
          plan_id,
          until: "2027-12-31T18:00:00Z",
          max_users: 5,
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("passes a complete activation to the existing owner guarded RPC", async () => {
    const response = await POST(
      request({
        action: "activate",
        reason: "Approved manual activation",
        organization_id: organization,
        revision: 0,
        plan_id: plan,
        until: "2027-12-31T18:00:00Z",
        max_users: 5,
      }),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "owner_manage_trial",
      expect.objectContaining({
        p_plan_id: plan,
        p_organization_id: organization,
        p_revision: 0,
        p_action: "activate",
      }),
    );
  });
  it("does not require plan details for a reasoned suspension", async () => {
    const response = await POST(
      request({
        action: "suspend",
        reason: "Administrative review hold",
        organization_id: organization,
        revision: 2,
      }),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "owner_manage_trial",
      expect.objectContaining({ p_action: "suspend", p_plan_id: null }),
    );
  });
  it("never exposes technical validation JSON in customer-facing errors", () => {
    const result = subscriptionError({
      issues: [{ format: "uuid", pattern: "INTERNAL_PATTERN" }],
      message: "SENSITIVE_VALIDATION_DETAILS",
    });
    expect(result).toEqual({ error: "INVALID_INPUT", status: 400 });
    for (const ar of [true, false])
      expect(
        adminSubscriptionError("SENSITIVE_VALIDATION_DETAILS", ar),
      ).not.toMatch(/SENSITIVE|uuid|pattern/);
  });
});
