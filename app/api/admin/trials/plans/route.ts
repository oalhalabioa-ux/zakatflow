import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { isSubscriptionSameOrigin } from "../../../../../lib/subscriptions/security";
import { subscriptionError } from "../../../../../lib/subscriptions/model";
const input = z
  .object({
    code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    name_ar: z.string().trim().min(2).max(120),
    name_en: z.string().trim().min(2).max(120),
    price: z.number().finite().min(0).max(100000000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    interval: z.enum(["monthly", "yearly"]),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export async function POST(request: Request) {
  if (!isSubscriptionSameOrigin(request))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    const b = input.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "owner_create_subscription_plan",
      {
        p_code: b.code,
        p_name_ar: b.name_ar,
        p_name_en: b.name_en,
        p_price: b.price,
        p_currency: b.currency,
        p_interval: b.interval,
        p_reason: b.reason,
      },
    );
    if (error) throw error;
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (e) {
    const v = subscriptionError(e);
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
}
