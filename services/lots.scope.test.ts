import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),rpc:vi.fn()}));
vi.mock('./auth',()=>({requireUser:mocks.requireUser}));
import {getLot,listLots} from './lots';
import {recordWorkspaceOwner} from '../lib/record-workspace-scope';
const actor='10000000-0000-4000-8000-000000000001',colleague='10000000-0000-4000-8000-000000000002';
const org='20000000-0000-4000-8000-000000000001',child='20000000-0000-4000-8000-000000000002',foreign='20000000-0000-4000-8000-000000000003';
const personalId='30000000-0000-4000-8000-000000000001',companyId='30000000-0000-4000-8000-000000000002',childId='30000000-0000-4000-8000-000000000003',foreignId='30000000-0000-4000-8000-000000000004',otherPersonal='30000000-0000-4000-8000-000000000005';
let fixtures:Record<string,any[]>,reads:Array<{table:string;select:string}>;
const value=(row:any,key:string)=>key.split('.').reduce((object,part)=>object?.[part],row);
function from(table:string){
 const read={table,select:''};reads.push(read);let filters:Array<(row:any)=>boolean>=[],single=false,range:[number,number]|null=null;
 const q:any={select:(fields:string)=>{read.select=fields;return q},order:()=>q,
  eq:(key:string,expected:unknown)=>{filters.push(row=>value(row,key)===expected);return q},
  is:(key:string,expected:unknown)=>{filters.push(row=>expected===null?value(row,key)==null:value(row,key)===expected);return q},
  in:(key:string,expected:unknown[])=>{filters.push(row=>expected.includes(value(row,key)));return q},
  single:()=>{single=true;return q},maybeSingle:()=>{single=true;return q},range:(start:number,end:number)=>{range=[start,end];return q},
  then:(resolve:any,reject:any)=>{
   let rows=(fixtures[table]??[]).map(row=>table==='lots'&&read.select.includes('asset_accounts(')?{...row,asset_accounts:fixtures.asset_accounts.find(asset=>asset.id===row.asset_account_id)}:table==='zakat_assessment_lines'?{...row,zakat_assessments:fixtures.zakat_assessments.find(a=>a.id===row.assessment_id)}:row).filter(row=>filters.every(filter=>filter(row)));
   if(range)rows=rows.slice(range[0],range[1]+1);
   return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve,reject);
  }};return q;
}
beforeEach(()=>{
 vi.resetAllMocks();reads=[];mocks.rpc.mockResolvedValue({data:true,error:null});
 fixtures={profiles:[{id:actor,calendar_type:'GREGORIAN'}],organizations:[{id:org,name:'A'},{id:child,name:'A child',parent_organization_id:org},{id:foreign,name:'B'}],organization_members:[{user_id:actor,organization_id:org,status:'ACTIVE',role:'OWNER'},{user_id:actor,organization_id:child,status:'ACTIVE',role:'VIEWER'}],
  asset_accounts:[{id:'personal',user_id:actor,ownership_scope:'PERSONAL',organization_id:null,name:'My asset'},{id:'company',user_id:colleague,ownership_scope:'ORGANIZATION',organization_id:org,name:'Colleague company asset'},{id:'child',user_id:actor,ownership_scope:'ORGANIZATION',organization_id:child},{id:'foreign',user_id:actor,ownership_scope:'ORGANIZATION',organization_id:foreign},{id:'other-personal',user_id:colleague,ownership_scope:'PERSONAL',organization_id:null}],
  lots:[{id:personalId,asset_account_id:'personal',user_id:actor,organization_id:null,hawl_start_date:null,hawl_due_date:null},{id:companyId,asset_account_id:'company',user_id:colleague,organization_id:null,hawl_start_date:'2026-01-01',hawl_due_date:'2027-01-01'},{id:childId,asset_account_id:'child',user_id:actor,organization_id:null,hawl_start_date:null},{id:foreignId,asset_account_id:'foreign',user_id:actor,organization_id:null,hawl_start_date:'invalid-date'},{id:otherPersonal,asset_account_id:'other-personal',user_id:colleague,organization_id:null}],
  zakat_assessments:[{id:'personal-assessment',user_id:actor,organization_id:null},{id:'corporate-assessment',user_id:colleague,organization_id:org},{id:'foreign-assessment',user_id:actor,organization_id:foreign}],
  zakat_assessment_lines:[{id:'company-line',lot_id:companyId,assessment_id:'corporate-assessment'},{id:'mixed-personal-line',lot_id:companyId,assessment_id:'personal-assessment'},{id:'foreign-line',lot_id:companyId,assessment_id:'foreign-assessment'}],
 };
 mocks.requireUser.mockResolvedValue({user:{id:actor},supabase:{from,rpc:mocks.rpc}});
});
it('lists only personal parent assets and this user lots before computing dates',async()=>{
 fixtures.lots.push({id:'wrong-owner',asset_account_id:'personal',user_id:colleague,organization_id:null});
 const rows=await listLots();expect(rows.map(row=>row.id)).toEqual([personalId]);expect(rows[0].computed_hawl_due_date).toBeNull();
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('includes authorized colleague lots through the company parent and resolves nullable legacy ownership',async()=>{
 const rows=await listLots({scope:'ORGANIZATION',organization_id:org,group:false});
 expect(rows.map(row=>row.id)).toEqual([companyId]);expect(rows[0].organization_id).toBe(org);expect(rows[0].asset_accounts.user_id).toBe(colleague);
 expect(recordWorkspaceOwner(rows[0])).toEqual({scope:'ORGANIZATION',organizationId:org});
 expect(mocks.rpc).toHaveBeenCalledWith('has_organization_permission',{p_organization_id:org,p_permission:'assets.view'});
});
it('includes group descendants only after checking each membership and view permission',async()=>{
 const rows=await listLots({scope:'ORGANIZATION',organization_id:org,group:true});expect(rows.map(row=>row.id).sort()).toEqual([companyId,childId].sort());
 fixtures.organization_members[1].status='INACTIVE';
 await expect(listLots({scope:'ORGANIZATION',organization_id:org,group:true})).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
});
it('preserves corporate stored Hawl dates independently of the viewing member personal calendar',async()=>{
 fixtures.lots[1].hawl_due_date='2028-02-03';
 for(const calendar_type of ['GREGORIAN','HIJRI_TABULAR']){
  fixtures.profiles[0].calendar_type=calendar_type;
  const rows=await listLots({scope:'ORGANIZATION',organization_id:org});expect(rows[0].computed_hawl_due_date).toBe('2028-02-03');
 }
 expect(reads.some(read=>read.table==='profiles')).toBe(false);
});
it('rejects missing, mixed, unrelated or denied company scopes before any lot query',async()=>{
 await expect(listLots({scope:'ORGANIZATION'})).rejects.toThrow('LOT_SCOPE_INVALID');
 await expect(listLots({scope:'PERSONAL',organization_id:org})).rejects.toThrow('LOT_SCOPE_INVALID');
 await expect(listLots({scope:'ORGANIZATION',organization_id:foreign})).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
 mocks.rpc.mockResolvedValueOnce({data:false,error:null});
 await expect(listLots({scope:'ORGANIZATION',organization_id:org})).rejects.toThrow('LOT_ACCESS_DENIED');
 expect(reads.some(read=>read.table==='lots')).toBe(false);
});
it('allows an authorized colleague lot detail without weakening personal ownership or including other assessment scopes',async()=>{
 const detail=await getLot(companyId);
 expect(detail.id).toBe(companyId);expect(detail.organization_id).toBe(org);expect(detail.asset_accounts.ownership_scope).toBe('ORGANIZATION');
 expect(detail.assessment_lines.map((line:any)=>line.id)).toEqual(['company-line']);
 expect(recordWorkspaceOwner(detail)).toEqual({scope:'ORGANIZATION',organizationId:org});
 expect((await getLot(personalId)).organization_id).toBeNull();
 await expect(getLot(otherPersonal)).rejects.toThrow('LOT_ACCESS_DENIED');
});
it('denies unrelated company details before returning source transactions, allocations or assessment history',async()=>{
 await expect(getLot(foreignId)).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
 expect(reads.some(read=>read.table==='lots'&&read.select.includes('transaction_allocations'))).toBe(false);
 expect(reads.some(read=>read.table==='zakat_assessment_lines')).toBe(false);
});
it('fails closed on explicit lot/parent ownership conflicts and unavailable IDs',async()=>{
 fixtures.lots[1].organization_id=child;
 await expect(getLot(companyId)).rejects.toThrow('LOT_SCOPE_INVALID');
 await expect(listLots({scope:'ORGANIZATION',organization_id:org})).rejects.toThrow('LOT_SCOPE_INVALID');
 await expect(getLot('30000000-0000-4000-8000-000000000099')).rejects.toThrow('LOT_NOT_FOUND');
});
