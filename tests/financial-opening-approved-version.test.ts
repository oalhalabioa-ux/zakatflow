import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {rpc,from,eq,select,limit}=vi.hoisted(()=>({
 rpc:vi.fn(),from:vi.fn(),eq:vi.fn(),select:vi.fn(),limit:vi.fn(),
}));
vi.mock('../services/auth',()=>({requireUser:async()=>({supabase:{rpc,from}})}));
import {readOpening} from '../services/financial-opening-workspace';

const scope={organization:'10000000-0000-4000-8000-000000000001',fiscalStart:'2026-01-01'};
beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubEnv('FINANCIAL_OPENING_WORKSPACE','true');
 from.mockReturnValue({select});
 select.mockReturnValue({eq});
 eq.mockReturnValue({eq,limit});
});
afterEach(()=>vi.unstubAllEnvs());

it.each([true,false])('returns the prior approved version for a replacement draft (canSave=%s)',async canSave=>{
 rpc.mockResolvedValue({data:{workspace:{status:'DRAFT',version:1},canSave},error:null});
 limit.mockResolvedValue({data:[{version:7}],error:null});
 const result=await readOpening(scope);
 expect(result).toMatchObject({workspace:{status:'DRAFT',version:1},approvedOpeningVersion:7,replacesApproved:canSave});
 expect(from).toHaveBeenCalledWith('financial_opening_workspaces');
 expect(select).toHaveBeenCalledWith('version');
 expect(eq.mock.calls).toEqual([['organization_id',scope.organization],['fiscal_start',scope.fiscalStart],['status','APPROVED']]);
});

it('distinguishes a first draft from a replacement draft',async()=>{
 rpc.mockResolvedValue({data:{workspace:{status:'DRAFT',version:1},canSave:true},error:null});
 limit.mockResolvedValue({data:[],error:null});
 const data=await readOpening(scope);
 expect(data.approvedOpeningVersion).toBeUndefined();
 expect(data.replacesApproved).toBe(false);
});

it('uses the current approved workspace without requiring a second read',async()=>{
 const workspace={status:'APPROVED',version:7};
 rpc.mockResolvedValue({data:{workspace,canSave:true},error:null});
 expect(await readOpening(scope)).toMatchObject({workspace});
 expect(from).not.toHaveBeenCalled();
});
