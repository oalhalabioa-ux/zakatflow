import { NextResponse } from 'next/server';
import { feasibilitySelfServeEnabled } from '@/lib/feasibility/grant';
import { isSameOriginRequest } from '@/lib/request-origin';
import { supabaseServer } from '@/lib/supabase/server';

const json = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES !== 'true' || !feasibilitySelfServeEnabled()) {
    return json('FEASIBILITY_ENROLLMENT_DISABLED', 404);
  }
  if (!isSameOriginRequest(request)) return json('INVALID_ORIGIN', 403);
  const supabase = await supabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json('UNAUTHORIZED', 401);

  const { error } = await supabase.rpc('start_personal_feasibility_trial');
  if (error) {
    return error.code === '42501'
      ? json('FEASIBILITY_VERIFIED_ACCOUNT_REQUIRED', 403)
      : json('FEASIBILITY_ENROLLMENT_FAILED', 503);
  }
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
}
