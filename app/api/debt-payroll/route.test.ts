import {expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({action:vi.fn(),workspace:vi.fn()}));
vi.mock('../../../services/debt-payroll',()=>({debtPayrollAction:m.action,debtPayrollWorkspace:m.workspace}));
import {GET,POST} from './route';
it('blocks cross-origin payroll actions and preserves approval errors',async()=>{m.action.mockClear();const r=await POST(new Request('https://app.test/api/debt-payroll',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}));expect(r.status).toBe(403);expect(m.action).not.toHaveBeenCalled();m.action.mockRejectedValueOnce(Error('VALID_APPROVAL_REQUIRED'));const denied=await POST(new Request('https://app.test/api/debt-payroll',{method:'POST',headers:{origin:'https://app.test'},body:'{}'}));expect(denied.status).toBe(400);expect(await denied.json()).toEqual({error:'VALID_APPROVAL_REQUIRED'})});
it('keeps payroll lists scoped and uncached',async()=>{m.workspace.mockResolvedValueOnce({});const r=await GET(new Request('https://app.test/api/debt-payroll?organization_id=company'));expect(m.workspace).toHaveBeenLastCalledWith('company');expect(r.headers.get('Cache-Control')).toBe('no-store')});
