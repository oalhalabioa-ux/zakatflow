import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { isSubscriptionSameOrigin } from "../../../../../lib/subscriptions/security";
import { subscriptionError } from "../../../../../lib/subscriptions/model";
import { ALL_CAPABILITIES } from "../../../../../lib/subscriptions/catalog";
const input = z
  .object({
    id: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    family: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    name_ar: z.string().trim().min(2).max(120),
    name_en: z.string().trim().min(2).max(120),
    description_ar: z.string().max(500),
    description_en: z.string().max(500),
    price: z
      .number()
      .finite()
      .min(0)
      .max(100000000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001),
    currency: z.string().regex(/^[A-Z]{3}$/),
    interval: z.enum(["monthly", "yearly"]),
    max_users: z.number().int().min(1).max(100000),
    features: z
      .array(z.string().refine((x) => ALL_CAPABILITIES.includes(x)))
      .min(2)
      .max(8)
      .refine(
        (x) =>
          new Set(x).size === x.length &&
          x.includes("module:assets") &&
          x.includes("module:liquidity"),
      ),
    is_active: z.boolean(),
    is_published: z.boolean(),
    is_proposed: z.boolean(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict()
  .refine((x) => !x.id || !!x.revision);
// Preserve already-open owner clients during a rolling release. Legacy plans stay unpublished.
const legacyInput = z
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
    const body = await request.json(),
      legacy = legacyInput.safeParse(body);
    if (legacy.success) {
      const { supabase } = await requireUser(),
        b = legacy.data;
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
    }
    const { reason, ...details } = input.parse(body);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("owner_save_subscription_plan", {
      p_details: details,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    const v = subscriptionError(e);
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
}
