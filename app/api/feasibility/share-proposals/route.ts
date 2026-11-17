import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '@/lib/request-origin';
import { supabaseServer } from '@/lib/supabase/server';

const enabled = () => process.env.FEASIBILITY_ORG_SHARING === 'true'
  && process.env.FEASIBILITY_ORG_QA === 'true' && process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES === 'true';
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const uuid = z.string().uuid();
const target = z.object({ organization: uuid, project: uuid });
const revision = z.number().int().positive().max(2147483647);
const change = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('submit'), revision }).strict(),
  target.extend({ action: z.literal('approve'), proposal: uuid, revision,
    resolutions: z.record(z.string(), z.enum(['current','proposed'])) }).strict(),
  target.extend({ action: z.literal('reject'), proposal: uuid, reason: z.string().trim().max(2000).optional() }).strict(),
]);
const view = target.extend({ action: z.enum(['list','review','recipient']), proposal: uuid.optional() });
type Input = z.infer<typeof change> | z.infer<typeof view>;

async function run(input: Input) {
  const supabase = await supabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'UNAUTHORIZED' }, 401);
  const { data, error } = await supabase.rpc('feasibility_share_proposal', {
    p_action: input.action, p_org: input.organization, p_project: input.project,
    ...('proposal' in input && { p_proposal: input.proposal }),
    ...('revision' in input && { p_revision: input.revision }),
    ...(input.action === 'approve' && { p_resolutions: input.resolutions }),
    ...(input.action === 'reject' && { p_reason: input.reason }),
  });
  if (error) {
    if (error.code === '42501') return json({ error: 'FEASIBILITY_PROPOSAL_FORBIDDEN' }, 403);
    if (error.code === '40001') return json({ error: 'FEASIBILITY_PROPOSAL_STALE' }, 409);
    if (error.code === '22023') return json({ error: error.message === 'FEASIBILITY_PROPOSAL_NO_CHANGES'
      ? error.message : 'FEASIBILITY_INVALID_PROPOSAL' }, 400);
    return json({ error: 'FEASIBILITY_PROPOSAL_UNAVAILABLE' }, 503);
  }
  return data === null ? json({ error: 'FEASIBILITY_PROPOSAL_UNAVAILABLE' }, 404) : json(data);
}

export async function GET(request: Request) {
  if (!enabled()) return json({ error: 'FEASIBILITY_PROPOSAL_UNAVAILABLE' }, 404);
  const parsed = view.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || (parsed.data.action === 'review' && !parsed.data.proposal))
    return json({ error: 'FEASIBILITY_INVALID_PROPOSAL' }, 400);
  return run(parsed.data);
}

export async function POST(request: Request) {
  if (!enabled()) return json({ error: 'FEASIBILITY_PROPOSAL_UNAVAILABLE' }, 404);
  if (!isSameOriginRequest(request)) return json({ error: 'INVALID_ORIGIN' }, 403);
  const body = await request.text();
  if (body.length > 8000) return json({ error: 'FEASIBILITY_INVALID_PROPOSAL' }, 400);
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return json({ error: 'FEASIBILITY_INVALID_PROPOSAL' }, 400); }
  const parsed = change.safeParse(payload);
  return parsed.success ? run(parsed.data) : json({ error: 'FEASIBILITY_INVALID_PROPOSAL' }, 400);
}
