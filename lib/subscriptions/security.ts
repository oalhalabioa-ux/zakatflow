import { isSameOriginRequest } from "../request-origin";
/** Preserve the deployed origin policy, with a strictly loopback-only exception for isolated Next QA. */
export function isSubscriptionSameOrigin(request: Request) {
  if (isSameOriginRequest(request)) return true;
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;
  try {
    const origin = new URL(request.headers.get("origin") ?? ""),
      target = new URL(request.url);
    const loopback = (value: URL) =>
      value.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(value.hostname);
    return (
      loopback(origin) &&
      loopback(target) &&
      origin.port === target.port &&
      request.headers.get("host") === origin.host
    );
  } catch {
    return false;
  }
}
