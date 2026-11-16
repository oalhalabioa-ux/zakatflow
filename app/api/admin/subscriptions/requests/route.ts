import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { subscriptionError } from "@/lib/subscriptions/model";
import { isSubscriptionSameOrigin } from "@/lib/subscriptions/security";
const input = z
  .object({
    request_id: z.uuid(),
    revision: z.number().int().positive(),
    action: z.enum(["review", "needs_info", "approve", "reject"]),
    reason: z.string().trim().min(5).max(1000),
    until: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("owner_activation_requests", {
      p_search: (q.get("search") ?? "").slice(0, 120),
      p_status: q.get("status") ?? "",
      p_offset: Math.max(0, Number(q.get("offset")) || 0),
    });
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    const v = subscriptionError(e);
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
}
export async function POST(request: Request) {
  if (!isSubscriptionSameOrigin(request))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    const b = input.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "owner_review_activation_request",
      {
        p_request_id: b.request_id,
        p_revision: b.revision,
        p_action: b.action,
        p_reason: b.reason,
        p_until: b.until ?? null,
      },
    );
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    const v = subscriptionError(e);
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
}
