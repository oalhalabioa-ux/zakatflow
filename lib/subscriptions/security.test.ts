import { it, expect } from "vitest";
import { isSubscriptionSameOrigin } from "./security";
it("accepts only same-port browser loopback reconstruction during isolated QA", () => {
  const req = (origin: string, site = "same-origin", host = "127.0.0.1:3000") =>
    new Request("http://localhost:3000/api/admin/trials", {
      headers: { Origin: origin, "Sec-Fetch-Site": site, Host: host },
    });
  expect(isSubscriptionSameOrigin(req("http://127.0.0.1:3000"))).toBe(true);
  expect(
    isSubscriptionSameOrigin(req("http://127.0.0.1:3000", "cross-site")),
  ).toBe(false);
  expect(
    isSubscriptionSameOrigin(
      req("http://127.0.0.1:4000", "same-origin", "127.0.0.1:4000"),
    ),
  ).toBe(false);
  expect(
    isSubscriptionSameOrigin(
      req("https://attacker.example", "same-origin", "attacker.example"),
    ),
  ).toBe(false);
  expect(
    isSubscriptionSameOrigin(
      req("http://127.0.0.1:3000", "same-origin", "attacker.example"),
    ),
  ).toBe(false);
  expect(isSubscriptionSameOrigin(req("null"))).toBe(false);
});
