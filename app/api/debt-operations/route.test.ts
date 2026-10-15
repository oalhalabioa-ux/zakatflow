import {expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({action:vi.fn(),workspace:vi.fn()}));
vi.mock('../../../services/debt-operations',()=>({debtOperationAction:mock.action,debtOperationWorkspace:mock.workspace}));
import {POST,GET} from './route';
it('rejects cross-origin financial commands without reaching the writer',async()=>{mock.action.mockClear();const r=await POST(new Request('https://app.test/api/debt-operations',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}));expect(r.status).toBe(403);expect(mock.action).not.toHaveBeenCalled()});
it('maps denied operation access to 403 without exposing error internals',async()=>{mock.action.mockRejectedValueOnce(Error('DEBT_OPERATION_ACCESS_DENIED'));const r=await POST(new Request('https://app.test/api/debt-operations',{method:'POST',headers:{origin:'https://app.test'},body:'{}'}));expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'DEBT_OPERATION_ACCESS_DENIED'})});
it('does not cache financial operation request lists',async()=>{mock.workspace.mockResolvedValueOnce([]);const r=await GET(new Request('https://app.test/api/debt-operations?organization_id=x&target_id=y'));expect(r.headers.get('Cache-Control')).toBe('no-store');expect(mock.workspace).toHaveBeenLastCalledWith('x','y')});
