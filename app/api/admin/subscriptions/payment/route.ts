import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { subscriptionError } from "@/lib/subscriptions/model";
import { isSubscriptionSameOrigin } from "@/lib/subscriptions/security";
const input = z
  .object({
    provider: z.string().trim().max(80),
    environment: z.enum(["test", "production"]),
    revision: z.number().int().positive(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export async function POST(request: Request) {
  if (!isSubscriptionSameOrigin(request))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    const b = input.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("owner_payment_readiness", {
      p_provider: b.provider,
      p_environment: b.environment,
      p_revision: b.revision,
      p_reason: b.reason,
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
