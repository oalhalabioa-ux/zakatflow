import { beforeEach, expect, it, vi } from "vitest";
const { getSettings, updateSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/services/settings", () => ({ getSettings, updateSettings }));
import { GET, PUT } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
});
it("keeps personal settings private and uncached", async () => {
  getSettings.mockResolvedValue({ profile: { name: "Private" } });
  const r = await GET();
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect((await r.json()).profile.name).toBe("Private");
});
it("rejects cross-origin preference writes before touching data", async () => {
  const r = await PUT(
    new Request("https://app.yaqeenbiz.com/api/settings", {
      method: "PUT",
      headers: { origin: "https://untrusted.example" },
      body: "{}",
    }),
  );
  expect(r.status).toBe(403);
  expect(updateSettings).not.toHaveBeenCalled();
});
it("preserves authenticated settings writes and reports failures", async () => {
  updateSettings.mockRejectedValue(new Error("UNAUTHORIZED"));
  const r = await PUT(
    new Request("https://app.yaqeenbiz.com/api/settings", {
      method: "PUT",
      headers: {
        origin: "https://app.yaqeenbiz.com",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    }),
  );
  expect(r.status).toBe(401);
  expect(updateSettings).toHaveBeenCalledWith({});
});
