import { describe, it, expect } from "vitest";
import {
  displaySubscriptionDate,
  subscriptionError,
  subscriptionLabel,
} from "./model";
describe("subscription presentation and errors", () => {
  it("formats the same instant in user timezones with Gregorian dates", () => {
    const date = "2026-10-30T23:30:00Z";
    expect(displaySubscriptionDate(date, "en", "Asia/Riyadh")).toContain(
      "31 Oct",
    );
    expect(displaySubscriptionDate(date, "en", "UTC")).toContain("30 Oct");
    expect(displaySubscriptionDate(date, "en", "invalid")).toContain("30 Oct");
  });
  it("does not call legacy access a paid subscription", () => {
    expect(subscriptionLabel("legacy", false)).toBe(
      "Existing access preserved",
    );
    expect(subscriptionLabel("expired", true)).toContain("تصدير");
  });
  it("maps authorization and concurrent changes without turning failures into success", () => {
    expect(
      subscriptionError({ message: "SUBSCRIPTION_READ_ONLY" }).status,
    ).toBe(403);
    expect(subscriptionError({ message: "SUBSCRIPTION_CONFLICT" }).status).toBe(
      409,
    );
    expect(
      subscriptionError({ message: "SUBSCRIPTION_USER_LIMIT" }).status,
    ).toBe(409);
  });
});
