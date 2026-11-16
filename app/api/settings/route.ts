import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/services/settings";
import { isSubscriptionSameOrigin } from "../../../lib/subscriptions/security";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    return NextResponse.json(await getSettings(), { headers });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "REQUEST_FAILED";
    return NextResponse.json(
      { error },
      { status: error === "UNAUTHORIZED" ? 401 : 500, headers },
    );
  }
}
export async function PUT(req: Request) {
  if (!isSubscriptionSameOrigin(req))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  try {
    return NextResponse.json(await updateSettings(await req.json()), {
      headers,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "REQUEST_FAILED";
    return NextResponse.json(
      { error },
      { status: error === "UNAUTHORIZED" ? 401 : 400, headers },
    );
  }
}
