import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), requireMember: vi.fn(), from: vi.fn() }));
vi.mock('../services/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../services/organization-access', () => ({ requireOrganizationMember: mocks.requireMember }));
import { GET } from '../app/api/vat/register/route';
beforeEach(() => { vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ supabase: { from: mocks.from }, user: { id:'actor' } }); });
it('rejects unauthenticated reads before querying invoice data', async () => {
  mocks.requireUser.mockRejectedValue(new Error('UNAUTHORIZED'));
  const response = await GET(new Request('https://example.test/api/vat/register?organization_id=org'));
  expect(response.status).toBe(401); expect(mocks.from).not.toHaveBeenCalled();
});
it('rejects cross-company reads before querying invoice data', async () => {
  mocks.requireMember.mockRejectedValue(new Error('ORGANIZATION_ACCESS_REQUIRED'));
  const response = await GET(new Request('https://example.test/api/vat/register?organization_id=other'));
  expect(response.status).toBe(403); expect(mocks.requireMember).toHaveBeenCalledWith(expect.anything(),'actor','other'); expect(mocks.from).not.toHaveBeenCalled();
});
it('rejects invalid offsets instead of unbounded or ambiguous page queries', async () => {
  const response = await GET(new Request('https://example.test/api/vat/register?organization_id=org&offset=-1'));
  expect(response.status).toBe(400); expect(mocks.from).not.toHaveBeenCalled();
});
