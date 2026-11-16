import { describe, expect, it } from "vitest";
import { ownerRegisterQuery } from "../lib/subscriptions/owner-query";
describe("owner register navigation state", () => {
  it("preserves separate organization and request filters in a shareable URL", () => {
    const p = new URLSearchParams(
      "tab=plans&org_search=Horizon&org_status=trialing&org_offset=50&req_search=REQ-0001&req_status=pending",
    );
    expect(ownerRegisterQuery(p, "org")).toEqual({
      search: "Horizon",
      status: "trialing",
      offset: 50,
    });
    expect(ownerRegisterQuery(p, "req")).toEqual({
      search: "REQ-0001",
      status: "pending",
      offset: 0,
    });
  });
  it.each(["-50", "NaN", "Infinity", "1.5", "9007199254740992"])(
    "ignores invalid pagination %s",
    (offset) => {
      expect(
        ownerRegisterQuery(new URLSearchParams({ org_offset: offset }), "org")
          .offset,
      ).toBe(0);
    },
  );
});
