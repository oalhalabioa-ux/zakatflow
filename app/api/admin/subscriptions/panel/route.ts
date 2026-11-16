import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { subscriptionError } from "@/lib/subscriptions/model";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("organization_id");
    if (id) z.uuid().parse(id);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("owner_subscription_panel", {
      p_organization_id: id,
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
