import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import {isSubscriptionSameOrigin} from '../../../../lib/subscriptions/security';
import { subscriptionError } from "../../../../lib/subscriptions/model";
const input = z
  .object({
    action: z.enum(["extend", "activate", "suspend", "resume", "defaults"]),
    reason: z.string().trim().min(5).max(1000),
    organization_id: z.uuid().optional(),
    revision: z.number().int().min(0),
    days: z.number().int().min(1).max(365).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    plan_id: z.uuid().optional(),
    max_users: z.number().int().min(1).max(100000).optional(),
  })
  .strict();
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const { supabase } = await requireUser();
    const audit = q.get("audit");
    const { data, error } = audit
      ? await supabase.rpc("owner_trial_audit", {
          p_organization_id: audit === "settings" ? null : audit,
        })
      : await supabase.rpc("owner_trial_register", {
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
    const { data, error } = await supabase.rpc("owner_manage_trial", {
      p_action: b.action,
      p_reason: b.reason,
      p_organization_id: b.organization_id ?? null,
      p_revision: b.revision,
      p_days: b.days ?? null,
      p_until: b.until ?? null,
      p_plan_id: b.plan_id ?? null,
      p_max_users: b.max_users ?? null,
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
