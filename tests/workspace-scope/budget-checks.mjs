import assert from 'node:assert/strict';

/** Real authenticated API acceptance. Only the caller's disposable fixture organizations are used. */
export async function budgetScopeAcceptance({owner,orgA,orgB,foreignOrg,request,check}){
 assert.ok(owner?.id&&orgA&&orgB&&foreignOrg,'Disposable budget scope identities are required');
 const costCenter='SCOPE-AUDIT-'+Date.now();
 const payload=(organization,value)=>({
  organization_id:organization,organization_name:'',name:'Scope acceptance budget',fiscal_year:2027,
  currency:'SAR',scenario:'BASE',status:'DRAFT',cost_center:costCenter,opening_cash:0,minimum_cash_target:0,
  assumptions:{},notes:'Disposable scope-isolation acceptance fixture',
  lines:[{category:'OPEX',name:'Scope rent',line_type:'EXPENSE',sort_order:1,monthly_budget:Array(12).fill(value),monthly_actual:Array(12).fill(0),monthly_forecast:Array(12).fill(value)}],
 });
 const body=async(response,status)=>{
  assert.equal(response.status(),status,'Unexpected budget API status');
  return response.json();
 };
 let first,second;
 await check('Budget creates two separate company plans with the same cost center',async()=>{
  first=await body(await request('POST','/api/budget-plans',payload(orgA,10)),201);
  second=await body(await request('POST','/api/budget-plans',payload(orgB,90)),201);
  assert.ok(first.id&&second.id);assert.notEqual(first.id,second.id);
  assert.equal(first.organization_id,orgA);assert.equal(second.organization_id,orgB);
 });
 if(!first?.id||!second?.id)return;
 const listPath=organization=>'/api/budget-plans?'+new URLSearchParams({organization_id:organization,cost_center:costCenter,fiscal_year:'2027',scenario:'BASE'});
 const detailPath=(plan,organization)=>`/api/budget-plans/${plan.id}?organization_id=${encodeURIComponent(organization)}`;
 await check('Budget list and detail use exact company identifiers',async()=>{
  for(const [organization,plan,value] of [[orgA,first,10],[orgB,second,90]]){
   const rows=await body(await request('GET',listPath(organization)),200);
   assert.deepEqual(rows.map(row=>row.id),[plan.id]);
   assert.equal(rows[0].resolved_organization_id,organization);
   const detail=await body(await request('GET',detailPath(plan,organization)),200);
   assert.equal(detail.organization_id,organization);
   assert.deepEqual(detail.lines.find(line=>line.name==='Scope rent').monthly_budget,Array(12).fill(value));
  }
 });
 await check('Budget rejects company-mismatched detail, save and approval targets',async()=>{
  const before=await body(await request('GET',detailPath(second,orgB)),200);
  const wrongRead=await body(await request('GET',detailPath(second,orgA)),404);
  assert.equal(wrongRead.error,'BUDGET_ORGANIZATION_SCOPE_MISMATCH');
  const wrongWrite=await body(await request('PUT',`/api/budget-plans/${second.id}`,payload(orgA,400)),400);
  assert.equal(wrongWrite.error,'BUDGET_ORGANIZATION_SCOPE_MISMATCH');
  const wrongApproval=await body(await request('PATCH',`/api/budget-plans/${second.id}`,{organization_id:orgA,status:'IN_REVIEW'}),400);
  assert.equal(wrongApproval.error,'BUDGET_ORGANIZATION_SCOPE_MISMATCH');
  const after=await body(await request('GET',detailPath(second,orgB)),200);
  assert.deepEqual(after,before,'Rejected operations changed another company plan');
 });
 await check('Budget requires a selected company and rejects a nonmember company',async()=>{
  assert.equal((await body(await request('GET','/api/budget-plans'),400)).error,'ORGANIZATION_ID_REQUIRED');
  assert.equal((await body(await request('GET',listPath(foreignOrg)),403)).error,'ORGANIZATION_ACCESS_REQUIRED');
  assert.equal((await body(await request('POST','/api/budget-plans',payload(foreignOrg,900)),403)).error,'ORGANIZATION_ACCESS_REQUIRED');
 });
 await check('Budget saves the selected plan and keeps the other company unchanged after reload',async()=>{
  const before=await body(await request('GET',detailPath(second,orgB)),200);
  const updated=await body(await request('PUT',`/api/budget-plans/${first.id}`,payload(orgA,25)),200);
  assert.equal(updated.id,first.id);assert.equal(updated.organization_id,orgA);
  const reloaded=await body(await request('GET',detailPath(first,orgA)),200);
  assert.deepEqual(reloaded.lines.find(line=>line.name==='Scope rent').monthly_budget,Array(12).fill(25));
  assert.deepEqual(await body(await request('GET',detailPath(second,orgB)),200),before);
 });
}
