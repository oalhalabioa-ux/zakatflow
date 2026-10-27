import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({role:'OWNER',payload:null as Record<string,unknown>|null}));
const org='5317b456-07f5-47b2-a00c-6ce45988fba4';
const user='e0eb57e1-a9e2-4930-87c3-b18d6506a5d4';
vi.mock('@/services/auth',()=>({requireUser:async()=>({user:{id:user},supabase:{from:(table:string)=>{
 if(table==='organization_members'){const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:state.role}})};return q;}
 if(table!=='liquidity_flow_categories')throw Error('Unexpected write target');
 return {insert:(payload:Record<string,unknown>)=>{state.payload=payload;return {select:()=>({single:async()=>'created_by' in payload?{error:{code:'42501'}}:{data:{...payload,created_by:user,is_system:false},error:null}})}}};
}}})}));
vi.mock('@/services/organization-access',()=>({requireOrganizationMember:async()=>{},requireOrganizationAdmin:async()=>{}}));
vi.mock('@/lib/workspace-organization',()=>({organizationScopeIds:()=>new Set()}));
vi.mock('@/lib/liquidity-transfer',()=>({calculateLiquidityTransfer:vi.fn()}));
vi.mock('@/lib/intercompany-transfer',()=>({calculateIntercompanyTransfer:vi.fn()}));
vi.mock('@/services/financial-events',()=>({executeFinancialEventAction:vi.fn()}));
import {POST} from '../app/api/liquidity/route';

const body={kind:'category',organization_id:org,name_ar:'تصنيف اختبار',name_en:'Test category',accounting_group:'REVENUE',treatment_code:'OTHER_REVENUE',financial_classification_type:'REVENUE'};
const request=(extra={})=>new Request('https://preview.test/api/liquidity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...extra})});
beforeEach(()=>{state.role='OWNER';state.payload=null;});
describe('liquidity category creation with column grants',()=>{
 it('lets the database assign ownership instead of writing the protected owner column',async()=>{
  const response=await POST(request());expect(response.status).toBe(201);
  expect(state.payload).not.toHaveProperty('created_by');
  expect(await response.json()).toMatchObject({created_by:user,is_system:false,treatment_code:'OTHER_REVENUE'});
 });
 it('does not accept spoofed ownership or system-category flags',async()=>{
  const response=await POST(request({created_by:'someone-else',is_system:true}));expect(response.status).toBe(201);
  expect(state.payload).not.toHaveProperty('created_by');expect(state.payload).not.toHaveProperty('is_system');
 });
 it('rejects a member without a liquidity write role before inserting',async()=>{
  state.role='VIEWER';const response=await POST(request());expect(response.status).toBe(403);expect(state.payload).toBeNull();
 });
});
