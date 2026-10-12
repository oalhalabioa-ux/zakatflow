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

function fixtureDatabase(fixtures:Record<string,any[]>){
 mocks.from.mockImplementation((table:string)=>{
  let rows=[...(fixtures[table]||[])];
  const q:any={select:()=>q,eq:(k:string,v:any)=>{rows=rows.filter(r=>r[k]===v);return q},is:(k:string,v:any)=>{rows=rows.filter(r=>r[k]===v);return q},in:(k:string,v:any[])=>{rows=rows.filter(r=>v.includes(r[k]));return q},order:()=>q,range:async(a:number,b:number)=>({data:rows.slice(a,b+1),error:null}),then:(resolve:any,reject:any)=>Promise.resolve({data:rows,error:null}).then(resolve,reject)};return q;
 });
}
const assetTransaction={id:'tx',organization_id:'org',asset_account_id:'asset',transaction_type:'PURCHASE',transaction_date:'2026-10-01',reference:'SUP-1',currency:'SAR',base_currency:'SAR',gross_value:100,base_value:100,metadata:{financial_event_id:'event',vat_amount:15,fx_rate:1}};
const assetEvent={id:'event',organization_id:'org',source_module:'ASSETS_INTEGRATION',source_record_id:'tx',status:'COMMITTED',counterparty_id:'supplier',due_date:'2026-11-01'};
it('shows the source invoice and its existing settlement flow without generating a VAT document',async()=>{
 fixtureDatabase({transactions:[assetTransaction],financial_events:[assetEvent],liquidity_counterparties:[{id:'supplier',organization_id:'org',name:'Vendor'}],liquidity_flows:[{id:'flow',organization_id:'org',source_module:'ASSETS_INTEGRATION',source_record_id:'tx',amount:'115',settled_amount:'40',currency:'SAR',direction:'OUTFLOW',settlement_status:'PARTIAL'}]});
 const r=await GET(new Request('https://test/api/vat/register?organization_id=org'));expect(r.status).toBe(200);const body=await r.json();expect(body.rows).toHaveLength(1);expect(body.rows[0]).toMatchObject({source:'ASSETS',number:'SUP-1',total:115,tax:15,documentId:null,accountingStatus:'COMMITTED',status:'REGISTERED',flow:{settled_amount:'40'}});
});
it('does not duplicate an alias on a different register page',async()=>{
 const transactions=Array.from({length:201},(_,i)=>({...assetTransaction,id:i===200?'tx':'tx-'+i,metadata:i===200?assetTransaction.metadata:{}}));
 fixtureDatabase({transactions,financial_events:[assetEvent],vat_documents:[{id:'alias',organization_id:'org',asset_transaction_id:'tx'}]});
 const r=await GET(new Request('https://test/api/vat/register?organization_id=org&offset=200'));expect(r.status).toBe(200);expect((await r.json()).rows).toEqual([]);
});
