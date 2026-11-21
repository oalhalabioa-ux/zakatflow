import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '@/lib/request-origin';
import { supabaseServer } from '@/lib/supabase/server';
import { shareAccessSchema } from '@/lib/feasibility/sharing-permissions';

const enabled = () => process.env.NEXT_PUBLIC_FEASIBILITY_COMPANY_INVITATIONS === 'true'
  && process.env.FEASIBILITY_ORG_SHARING === 'true'
  && process.env.FEASIBILITY_ORG_QA === 'true'
  && process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES === 'true';

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

const uuid = z.string().uuid();
const readInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inbox'), organization: uuid }),
  z.object({ action: z.literal('directory_status'), organization: uuid }),
  z.object({ action: z.literal('directory_search'), organization: uuid, name: z.string().trim().min(2).max(100) }),
  z.object({ action: z.literal('outbox'), organization: uuid, project: uuid }),
]);
const writeInput = z.union([
  z.object({ action: z.enum(['directory_enable', 'directory_disable']), organization: uuid }).strict(),
  z.object({ action: z.literal('issue'), organization: uuid, recipient: uuid, project: uuid,
    revision: z.number().int().positive().max(2147483647),
    days: z.number().int().positive().max(2147483647), access: shareAccessSchema }).strict(),
  z.object({ action: z.enum(['accept', 'decline', 'withdraw', 'revoke']), organization: uuid, invitation: uuid }).strict(),
]);

const expectedErrors = new Set([
  'FEASIBILITY_COMPANY_INVITATION_DISABLED', 'FEASIBILITY_COMPANY_INVITATION_PENDING',
  'FEASIBILITY_COMPANY_INVITATION_RESOLVED', 'FEASIBILITY_SHARE_FORBIDDEN',
  'FEASIBILITY_STALE_SHARE_REVISION', 'FEASIBILITY_SHARE_EDIT_FORBIDDEN',
  'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS', 'FEASIBILITY_INVALID_SHARE',
]);

async function run(input: z.infer<typeof readInput> | z.infer<typeof writeInput>) {
  const supabase = await supabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'UNAUTHORIZED' }, 401);

  const { data, error } = await supabase.rpc('feasibility_company_invitations', {
    p_action: input.action, p_organization: input.organization,
    ...('project' in input && { p_project: input.project }),
    ...(input.action === 'directory_search' && { p_access: input.name }),
    ...('invitation' in input && { p_invitation: input.invitation }),
    ...(input.action === 'issue' && { p_recipient: input.recipient, p_revision: input.revision,
      p_days: input.days, p_access: input.access }),
  });
  if (!error) return json(data);
  const status = error.code === '42501' ? 403 : error.code === '40001' ? 409 : error.code === '22023' ? 400 : 503;
  return json({ error: expectedErrors.has(error.message) ? error.message : 'FEASIBILITY_SHARE_UNAVAILABLE' }, status);
}

export async function GET(request: Request) {
  if (!enabled()) return json({ error: 'FEASIBILITY_COMPANY_INVITATION_DISABLED' }, 404);
  const parsed = readInput.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: 'INVALID_SHARE_REQUEST' }, 400);
  return run(parsed.data);
}

export async function POST(request: Request) {
  if (!enabled()) return json({ error: 'FEASIBILITY_COMPANY_INVITATION_DISABLED' }, 404);
  if (!isSameOriginRequest(request)) return json({ error: 'INVALID_ORIGIN' }, 403);
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: 'INVALID_SHARE_REQUEST' }, 400);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'INVALID_SHARE_REQUEST' }, 400); }
  const parsed = writeInput.safeParse(payload);
  if (!parsed.success) return json({ error: 'INVALID_SHARE_REQUEST' }, 400);
  return run(parsed.data);
}
