import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),listAssets:vi.fn(),rpc:vi.fn()}));
vi.mock('./auth',()=>({requireUser:mocks.requireUser}));
vi.mock('./assets',()=>({listAssets:mocks.listAssets}));
import {readOperationalReports} from './operational-reports';
import {emptyManualZakatInput} from '../lib/manual-zakat-assessment';
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const org='20000000-0000-4000-8000-000000000001',child='20000000-0000-4000-8000-000000000002',foreign='20000000-0000-4000-8000-000000000003';
const personal={scope:'PERSONAL',organization_id:null,entity_id:null,group:false};
const company={scope:'ORGANIZATION',organization_id:org,entity_id:null,group:false};
let fixtures:Record<string,any[]>,readTables:string[],failed:Set<string>;
function query(table:string){
 readTables.push(table);let single=false,filters:Array<(row:any)=>boolean>=[],range:[number,number]|null=null;
 const q:any={select:()=>q,order:(key:string)=>{if(table==='corporate_zakat_workflow'&&key==='id')throw Error('WORKFLOW_HAS_ASSESSMENT_ID_ONLY');return q},
  eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q},is:(key:string,value:unknown)=>{filters.push(row=>value===null?row[key]==null:row[key]===value);return q},
  in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q},
  single:()=>{single=true;return q},maybeSingle:()=>{single=true;return q},range:(start:number,end:number)=>{range=[start,end];return q},
  then:(resolve:any,reject:any)=>{let rows=(fixtures[table]??[]).filter(row=>filters.every(filter=>filter(row)));if(range)rows=rows.slice(range[0],range[1]+1);return Promise.resolve({data:single?rows[0]??null:rows,error:failed.has(table)?new Error('OTHER_SCOPE_TABLE_UNAVAILABLE'):null}).then(resolve,reject)}
 };return q;
}
beforeEach(()=>{
 vi.resetAllMocks();readTables=[];failed=new Set();mocks.rpc.mockResolvedValue({data:true,error:null});
 fixtures={profiles:[{id:actor,name:'Personal owner'}],organizations:[{id:org,name:'Company A'},{id:child,name:'Company A child',parent_organization_id:org},{id:foreign,name:'Company B'}],organization_members:[{user_id:actor,organization_id:org,status:'ACTIVE',role:'OWNER'},{user_id:actor,organization_id:child,status:'ACTIVE',role:'VIEWER'}],
  asset_accounts:[{id:'personal-asset',user_id:actor,ownership_scope:'PERSONAL',organization_id:null},{id:'company-asset',user_id:other,ownership_scope:'ORGANIZATION',organization_id:org},{id:'foreign-asset',user_id:actor,ownership_scope:'ORGANIZATION',organization_id:foreign},{id:'other-personal-asset',user_id:other,ownership_scope:'PERSONAL',organization_id:null}],
  transactions:[{id:'personal-tx',user_id:actor,organization_id:null,asset_account_id:'personal-asset'},{id:'company-tx',user_id:other,organization_id:org,asset_account_id:'company-asset'},{id:'foreign-tx',user_id:actor,organization_id:foreign,asset_account_id:'foreign-asset'},{id:'other-personal-tx',user_id:other,organization_id:null,asset_account_id:'other-personal-asset'}],
  lots:[{id:'personal-lot',user_id:actor,asset_account_id:'personal-asset'},{id:'company-lot',user_id:other,asset_account_id:'company-asset'},{id:'foreign-lot',user_id:actor,asset_account_id:'foreign-asset'}],
  zakat_assessments:[{id:'personal-assessment',user_id:actor,organization_id:null},{id:'company-old-assessment',user_id:actor,organization_id:org},{id:'other-assessment',user_id:other,organization_id:null}],
  zakat_payments:[{id:'personal-payment',user_id:actor,assessment_id:'personal-assessment'},{id:'company-legacy-payment',user_id:actor,assessment_id:'company-old-assessment'},{id:'other-payment',user_id:other,assessment_id:'other-assessment'},{id:'wrong-parent-payment',user_id:actor,assessment_id:'other-assessment'}],
  manual_zakat_assessments:[{id:'company-assessment',organization_id:org,title:'Company A Zakat',assessment_date:'2026-11-25',currency:'SAR',model:'SIMPLE',input:{...emptyManualZakatInput('SIMPLE',org),title:'Company A Zakat'}},{id:'foreign-malformed-assessment',organization_id:foreign,input:{}}],
  corporate_zakat_workflow:[{assessment_id:'company-assessment',organization_id:org,flow_id:'linked-flow',amount:25,final_base:1000,final_rate:.025,paid:10,remaining:15,event_status:'ACTUAL',period_end:'2026-11-25',review_reference:'Approved QA reference'}],
  liquidity_flows:[{id:'linked-flow',organization_id:org,category_id:'zakat',direction:'OUTFLOW',amount:25,settled_amount:10,status:'CONFIRMED',settlement_status:'PARTIAL'},
   {id:'direct-flow',organization_id:org,category_id:'zakat',direction:'OUTFLOW',title:'Legacy Zakat payment',currency:'SAR',amount:20,settled_amount:5,status:'CONFIRMED',settlement_status:'PARTIAL',due_date:'2026-12-01'},
   {id:'forecast',organization_id:org,category_id:'zakat',direction:'OUTFLOW',title:'Forecast only',currency:'SAR',amount:900,status:'EXPECTED',settled_amount:0},
   {id:'transfer',organization_id:org,category_id:'zakat',direction:'OUTFLOW',amount:999,transfer_id:'transfer'},
   {id:'unrelated',organization_id:org,category_id:'payroll',direction:'OUTFLOW',amount:999,status:'ACTUAL'},
   {id:'foreign-flow',organization_id:foreign,category_id:'zakat-b',direction:'OUTFLOW',amount:999,status:'ACTUAL'}],
  liquidity_flow_categories:[{id:'zakat',organization_id:org,accounting_group:'ZAKAT'},{id:'payroll',organization_id:org,accounting_group:'PAYROLL'},{id:'zakat-b',organization_id:foreign,accounting_group:'ZAKAT'}]
 };
 mocks.requireUser.mockResolvedValue({user:{id:actor},supabase:{from:query,rpc:mocks.rpc}});
 mocks.listAssets.mockResolvedValue(fixtures.asset_accounts);
});
it('exports personal assets, movements and lots without the same user corporate data or another user records',async()=>{
 const r=await readOperationalReports(['transactions','lots','assessments','payments'],personal);
 expect(r.owner).toBe('Personal owner');
 expect(r.rows.transactions?.map(row=>row.id)).toEqual(['personal-tx']);
 expect(r.rows.lots?.map(row=>row.id)).toEqual(['personal-lot']);
 expect(r.rows.assessments?.map(row=>row.id)).toEqual(['personal-assessment']);
 expect(r.rows.payments?.map(row=>row.id)).toEqual(['personal-payment']);
 expect(readTables).not.toContain('manual_zakat_assessments');expect(readTables).not.toContain('liquidity_flows');
});
it('exports company-owned transactions and lots created by colleagues, with no other company or personal fallback',async()=>{
 const r=await readOperationalReports(['transactions','lots'],company);
 expect(r.rows.transactions?.map(row=>row.id)).toEqual(['company-tx']);
 expect(r.rows.lots?.map(row=>row.id)).toEqual(['company-lot']);
 expect(r.owner).toBe('Company A');
});
it('scopes a personal payments-only export through the owning assessment, excluding legacy company payments by the same user',async()=>{
 const r=await readOperationalReports(['payments'],personal);
 expect(r.rows.payments?.map(row=>row.id)).toEqual(['personal-payment']);
 expect(r.rows.assessments).toBeUndefined();
 expect(readTables).toContain('zakat_assessments');
});
it('reads corporate assessments from manual/workflow sources and keeps actual paid amounts separate from forecasts without duplicates',async()=>{
 failed.add('zakat_assessments');failed.add('zakat_payments');
 const r=await readOperationalReports(['assessments','payments'],company);
 expect(r.rows.assessments).toHaveLength(1);
 expect(r.rows.assessments?.[0]).toMatchObject({id:'company-assessment',organization_name:'Company A',total_zakatable_value:1000,zakat_due:25,paid_amount:10,remaining_amount:15,status:'PARTIAL'});
 expect(r.rows.payments?.map(row=>row.id)).toEqual(['company-assessment','direct-flow','forecast']);
 expect(r.rows.payments?.find(row=>row.id==='direct-flow')).toMatchObject({amount:20,paid_amount:5,remaining_amount:15,status:'CONFIRMED',settlement_status:'PARTIAL'});
 expect(r.rows.payments?.find(row=>row.id==='forecast')).toMatchObject({amount:900,paid_amount:0,remaining_amount:900,status:'EXPECTED'});
 expect(readTables).not.toContain('zakat_assessments');expect(readTables).not.toContain('zakat_payments');
});
it('rejects foreign organizations, missing permissions, and mixed personal scope before reading report sources',async()=>{
 await expect(readOperationalReports(['payments'],{...company,organization_id:foreign})).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
 await expect(readOperationalReports(['payments'],{...company,organization_id:null})).rejects.toThrow('REPORT_SCOPE_INVALID');
 await expect(readOperationalReports(['payments'],{...personal,organization_id:org})).rejects.toThrow('REPORT_SCOPE_INVALID');
 mocks.rpc.mockResolvedValueOnce({data:false,error:null});
 await expect(readOperationalReports(['payments'],company)).rejects.toThrow('REPORT_ACCESS_DENIED');
 expect(readTables).not.toContain('liquidity_flows');expect(readTables).not.toContain('manual_zakat_assessments');
});
it('retains company group currencies and cancelled or draft assessment history without treating forecasts as paid',async()=>{
 fixtures.manual_zakat_assessments.push({id:'child-assessment',organization_id:child,title:'Subsidiary Zakat',assessment_date:'2026-11-25',currency:'USD',status:'DRAFT',model:'SIMPLE',input:{...emptyManualZakatInput('SIMPLE',child),title:'Subsidiary Zakat',currency:'USD'}});
 fixtures.manual_zakat_assessments.push({id:'cancelled-assessment',organization_id:org,title:'Cancelled review',assessment_date:'2026-11-25',currency:'SAR',status:'DRAFT',model:'SIMPLE',input:{...emptyManualZakatInput('SIMPLE',org),title:'Cancelled review'}});
 fixtures.corporate_zakat_workflow.push({assessment_id:'cancelled-assessment',organization_id:org,flow_id:null,amount:40,final_base:1600,final_rate:.025,paid:0,remaining:0,event_status:'CANCELLED',period_end:'2026-11-25'});
 fixtures.liquidity_flow_categories.push({id:'child-zakat',organization_id:child,accounting_group:'ZAKAT'});
 fixtures.liquidity_flows.push({id:'child-payment',organization_id:child,category_id:'child-zakat',direction:'OUTFLOW',title:'USD payment',currency:'USD',amount:12,status:'ACTUAL',settled_amount:0,settlement_status:'PENDING'});
 const r=await readOperationalReports(['assessments','payments'],{...company,group:true});
 expect(r.rows.assessments?.map(row=>row.id)).toEqual(['company-assessment','child-assessment','cancelled-assessment']);
 expect(r.rows.assessments?.find(row=>row.id==='child-assessment')).toMatchObject({currency:'USD',basis:'MANUAL_DRAFT'});
 expect(r.rows.payments?.find(row=>row.id==='cancelled-assessment')).toMatchObject({currency:'SAR',amount:40,paid_amount:0,remaining_amount:0,status:'CANCELLED'});
 expect(r.rows.payments?.find(row=>row.id==='child-payment')).toMatchObject({currency:'USD',amount:12,paid_amount:12,remaining_amount:0,status:'ACTUAL'});
 expect(r.rows.payments?.find(row=>row.id==='company-assessment')).toMatchObject({currency:'SAR',amount:25,paid_amount:10,remaining_amount:15});
 expect(r.rows.payments?.some(row=>row.id==='child-assessment')).toBe(false);
});
it('includes only authorized group descendants and validates requested entity ownership',async()=>{
 fixtures.asset_accounts.push({id:'child-asset',user_id:other,ownership_scope:'ORGANIZATION',organization_id:child});
 fixtures.lots.push({id:'child-lot',user_id:other,asset_account_id:'child-asset'});
 const r=await readOperationalReports(['lots'],{...company,group:true});
 expect(r.rows.lots?.map(row=>row.id)).toEqual(['company-lot','child-lot']);
 fixtures.organization_members[1].status='INACTIVE';
 await expect(readOperationalReports(['lots'],{...company,group:true})).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
 await expect(readOperationalReports(['lots'],{...company,entity_id:'60000000-0000-4000-8000-000000000001'})).rejects.toThrow('REPORT_ENTITY_SCOPE_INVALID');
});
