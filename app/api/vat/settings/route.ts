import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/services/auth";
import { requireOrganizationMember } from "@/services/organization-access";
import { subscriptionError } from "@/lib/subscriptions/model";
// Focused read of the existing VAT profile; writes remain on the established VAT API.
export async function GET(request: Request) {
  try {
    const id = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("organization_id"));
    const { supabase, user } = await requireUser();
    const member = await requireOrganizationMember(supabase, user.id, id);
    const { data, error } = await supabase
      .from("vat_profiles")
      .select("*")
      .eq("organization_id", id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(
      { profile: data, can_edit: ["OWNER", "ADMIN"].includes(member.role) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const v = subscriptionError(e);
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
}
