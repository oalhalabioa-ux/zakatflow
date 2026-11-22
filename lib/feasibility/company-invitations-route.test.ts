import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '../../app/api/feasibility/company-invitations/route';

const { rpc, supabaseServer } = vi.hoisted(() => ({ rpc: vi.fn(), supabaseServer: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer }));
vi.mock('@/lib/request-origin', () => ({ isSameOriginRequest: () => true }));

const organization = '0f582242-fb8b-4fad-aea9-5414763bb64d';
const recipient = '2b288121-7035-43a8-b007-5503af25b726';
const project = '24440ca1-8e29-45a8-b4b6-c8ced2f3be1b';
const endpoint = 'https://qa.local/api/feasibility/company-invitations';

const post = (input: object) => POST(new Request(endpoint, {
  method: 'POST',
  body: JSON.stringify({ organization, ...input }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  for (const flag of ['NEXT_PUBLIC_FEASIBILITY_COMPANY_INVITATIONS', 'FEASIBILITY_ORG_SHARING',
    'FEASIBILITY_ORG_QA', 'NEXT_PUBLIC_FEASIBILITY_STUDIES']) vi.stubEnv(flag, 'true');
  supabaseServer.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: {} } }) } });
});

afterEach(() => vi.unstubAllEnvs());

it('stores and reads the reception preference through its own RPC', async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  const read = await GET(new Request(`${endpoint}?action=reception_status&organization=${organization}`));
  expect(await read.json()).toBe(false);
  expect(rpc).toHaveBeenLastCalledWith('feasibility_invitation_reception', { p_organization: organization });

  rpc.mockResolvedValue({ data: true, error: null });
  const write = await post({ action: 'reception_update', enabled: true });
  expect(await write.json()).toBe(true);
  expect(rpc).toHaveBeenLastCalledWith('feasibility_invitation_reception', {
    p_organization: organization, p_enabled: true,
  });
});

it('denies a direct recipient request when the pilot excludes it', async () => {
  const message = 'FEASIBILITY_INVITATION_PILOT_RESTRICTED';
  rpc.mockResolvedValue({ error: { code: '42501', message } });
  const response = await post({ action: 'issue', recipient, project, revision: 1, days: 10, access: 'read' });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: message });
  expect(rpc).toHaveBeenCalledWith('feasibility_issue_with_documents', expect.objectContaining({
    p_recipient: recipient, p_access: 'read', p_document_mode: 'none', p_documents: [],
  }));
});

it('denies acceptance when the recipient has stopped receiving invites', async () => {
  const message = 'FEASIBILITY_INVITATION_RECEPTION_DISABLED';
  rpc.mockResolvedValue({ error: { code: '42501', message } });
  const response = await post({ action: 'accept', invitation: project });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: message });
  expect(rpc).toHaveBeenCalledWith('feasibility_company_invitations', {
    p_action: 'accept', p_organization: organization, p_invitation: project,
  });
});

it('keeps access off when the company feature flag is off', async () => {
  vi.stubEnv('NEXT_PUBLIC_FEASIBILITY_COMPANY_INVITATIONS', 'false');
  expect((await post({ action: 'reception_update', enabled: true })).status).toBe(404);
  expect(supabaseServer).not.toHaveBeenCalled();
});
