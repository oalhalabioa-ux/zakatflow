import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { subscriptionError } from "@/lib/subscriptions/model";
import { isSubscriptionSameOrigin } from "@/lib/subscriptions/security";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("submit"),
      organization_id: z.uuid(),
      plan_id: z.uuid(),
      phone: z.string().trim().max(50),
      notes: z.string().trim().max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      organization_id: z.uuid(),
      request_id: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    const id = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("organization_id"));
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "subscription_activation_requests",
      { p_organization_id: id },
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
export async function POST(request: Request) {
  if (!isSubscriptionSameOrigin(request))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    const b = input.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "subscription_activation_requests",
      {
        p_organization_id: b.organization_id,
        p_action: b.action,
        ...(b.action === "submit"
          ? { p_plan_id: b.plan_id, p_phone: b.phone, p_notes: b.notes }
          : { p_request_id: b.request_id, p_revision: b.revision }),
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
