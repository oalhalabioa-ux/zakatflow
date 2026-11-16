import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '@/lib/request-origin';
import { supabaseServer } from '@/lib/supabase/server';

const enabled = () => process.env.FEASIBILITY_ORG_SHARING === 'true'
  && process.env.FEASIBILITY_ORG_QA === 'true'
  && process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES === 'true';
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const uuid = z.string().uuid();
const target = z.object({ organization: uuid, project: uuid, recipient: uuid });
const input = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('share'), revision: z.number().int().positive(), days: z.number().int().positive() }).strict(),
  target.extend({ action: z.literal('revoke') }).strict(),
]);

async function run(args: { p_action: string; p_organization: string; p_project?: string; p_recipient?: string; p_revision?: number; p_days?: number }) {
  const supabase = await supabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'UNAUTHORIZED' }, 401);
  const { data, error } = await supabase.rpc('feasibility_company_shares', args);
  if (error) {
    if (error.code === '42501') return json({ error: 'FEASIBILITY_SHARE_FORBIDDEN' }, 403);
    if (error.code === '40001') return json({ error: 'FEASIBILITY_STALE_SHARE_REVISION' }, 409);
    if (error.message.includes('FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS')) {
      return json({ error: 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS' }, 400);
    }
    if (['22023', '22008', '22015', '22003'].includes(error.code)) return json({ error: 'FEASIBILITY_INVALID_SHARE' }, 400);
    return json({ error: 'FEASIBILITY_SHARE_UNAVAILABLE' }, 503);
  }
  if (data === null) return json({ error: 'FEASIBILITY_SHARE_NOT_FOUND' }, 404);
  return json(data);
}

export async function GET(request: Request) {
  if (!enabled()) return json({ error: 'FEASIBILITY_ORGANIZATION_SHARING_DISABLED' }, 404);
  const p = new URL(request.url).searchParams;
  const action = p.get('action') ?? 'inbox';
  const organization = uuid.safeParse(p.get('organization'));
  const project = uuid.safeParse(p.get('project'));
  if (!organization.success || !['inbox', 'outbox', 'open'].includes(action)
    || (action !== 'inbox' && !project.success)) return json({ error: 'INVALID_SHARE_REQUEST' }, 400);
  return run({ p_action: action, p_organization: organization.data, ...(project.success && { p_project: project.data }) });
}

export async function POST(request: Request) {
  if (!enabled()) return json({ error: 'FEASIBILITY_ORGANIZATION_SHARING_DISABLED' }, 404);
  if (!isSameOriginRequest(request)) return json({ error: 'INVALID_ORIGIN' }, 403);
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: 'INVALID_SHARE_REQUEST' }, 400);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'INVALID_SHARE_REQUEST' }, 400); }
  const parsed = input.safeParse(payload);
  if (!parsed.success) return json({ error: 'INVALID_SHARE_REQUEST' }, 400);
  const d = parsed.data;
  return run({
    p_action: d.action, p_organization: d.organization, p_project: d.project, p_recipient: d.recipient,
    ...(d.action === 'share' && { p_revision: d.revision, p_days: d.days }),
  });
}
