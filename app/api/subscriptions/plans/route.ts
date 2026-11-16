import { NextResponse } from "next/server";
import { requireUser } from "@/services/auth";
import { subscriptionError } from "../../../../lib/subscriptions/model";
export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("subscription_plan_catalog");
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    const v = subscriptionError(e);
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
}
