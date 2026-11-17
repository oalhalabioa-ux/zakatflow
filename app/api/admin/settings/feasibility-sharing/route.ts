import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/request-origin';
import { sharingModeSchema } from '../../../../../lib/feasibility/sharing-permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { z } from 'zod';

const input = z.object({ mode: sharingModeSchema }).strict();
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: 'INVALID_ORIGIN' }, 403);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'INVALID_SHARING_MODE' }, 400);
  const db = await supabaseServer();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) return json({ error: 'UNAUTHORIZED' }, 401);
  const { data, error } = await db.rpc('feasibility_manage_sharing', { p_mode: parsed.data.mode });
  if (error) return json({ error: 'SHARING_POLICY_UPDATE_FAILED' }, error.code === '42501' ? 403 : 503);
  return json({ mode: data });
}
