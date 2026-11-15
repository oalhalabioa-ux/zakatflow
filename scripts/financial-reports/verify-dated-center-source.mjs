import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
/** Two real, dated source vouchers across a registered branch change. */
export async function verifyDatedCenterSource({actor,page,app,out,sql,databaseUrl,organization}){
 assert.equal(databaseUrl,'http://127.0.0.1:54321');assert.equal(new URL(app).hostname,'localhost');
 const center=randomUUID(),branch=randomUUID();
 sql(`select set_config('request.jwt.claim.sub','${actor.id}',false);
 insert into public.organization_entities(id,organization_id,name,entity_type,active) values('${branch}','${organization}','Dated center branch','BRANCH',true);
 insert into public.organization_cost_centers(id,organization_id,code,name,center_type) values('${center}','${organization}','DATED_CENTER','Dated center','OPERATING');`);
 const rpc=async(name,args)=>{const r=await actor.client.rpc(name,args);assert.ifError(r.error);return r.data};
 let registry=await rpc('financial_center_branch_registry',{p_org:organization});
 const first=await rpc('assign_financial_center_branch',{p_org:organization,p_center:center,p_branch:null,p_from:'2026-01-01',p_to:'2026-09-30',p_expected_revision:Number(registry.revision),p_reason:'Original headquarters period before branch assignment'});
 await rpc('assign_financial_center_branch',{p_org:organization,p_center:center,p_branch:branch,p_from:'2026-10-01',p_to:null,p_expected_revision:first.revision,p_reason:'Dated branch period set before source vouchers'});
 const cls=await actor.client.from('financial_classifications').select('id').eq('organization_id',organization).eq('code','OPEX').single();assert.ifError(cls.error);
 const command=async data=>{const r=await page.request.post(app+'/api/financial-events',{data,headers:{origin:app}});assert.equal(r.status(),200,await r.text());return(await r.json()).result};
 const events=[];
 for(const [date,entity,amount]of [['2026-09-15',null,10],['2026-10-15',branch,20]]){
  const id=await command({action:'CREATE',payload:{organization_id:organization,entity_id:entity,counterparty_id:null,event_type:'EXPENSE',source_module:'OPERATIONAL_CONSOLE',source_record_id:null,source_event_key:'dated-center:'+randomUUID(),event_date:date,due_date:date,base_currency:'SAR',description:'Dated center source',lines:[{line_number:1,cost_center_id:center,description:'Original dated attribution',classification_id:cls.data.id,amount,base_amount:amount,currency:'SAR',exchange_rate:1,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[{obligation_key:'dated-payable',obligation_type:'PAYABLE',settleable_amount:amount,currency:'SAR',exchange_rate:1,base_currency:'SAR',settleable_base_amount:amount}],links:[]}});
  for(const status of ['PLANNED','COMMITTED'])await command({action:'TRANSITION',organization_id:organization,event_id:id,status,note:'Dated center acceptance'});
  await command({action:'APPROVE',organization_id:organization,event_id:id,note:'Approve original dated center source'});
  await command({action:'TRANSITION',organization_id:organization,event_id:id,status:'ACTUAL',note:'Post original dated center source'});events.push(id);
 }
 const read=async(from,to)=>{const r=await page.request.get(app+'/api/financial-reporting/live-statements?'+new URLSearchParams({action:'cost-center-statements',organization,from,to}));assert.equal(r.status(),200,await r.text());return r.json()};
 const historical=await read('2026-01-01','2026-09-30'),full=await read('2026-01-01','2026-12-31'),later=await read('2026-11-01','2026-12-31');
 const rows=full.rows.filter(r=>r.centerId===center);
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.branchId===null).statements.position.liabilities,'10.0000');assert.equal(rows.find(r=>r.branchId===branch).statements.position.liabilities,'20.0000');
 assert.equal(historical.rows.find(r=>r.centerId===center).statements.income.netProfit,'-10.0000');
 assert.equal(later.rows.filter(r=>r.centerId===center).reduce((n,r)=>n+Number(r.statements.position.liabilities),0),30);
 assert.equal(later.rows.filter(r=>r.centerId===center).reduce((n,r)=>n+Number(r.statements.income.netProfit),0),0);
 assert.equal(rows.reduce((n,r)=>n+Number(r.statements.cash.closing),0),0);
 const originals=await actor.client.from('financial_events').select('id,entity_id,event_date').in('id',events).eq('organization_id',organization);assert.ifError(originals.error);assert.equal(originals.data.find(r=>r.id===events[0]).entity_id,null);assert.equal(originals.data.find(r=>r.id===events[1]).entity_id,branch);
 await page.goto(app+'/en/financial-reports?organization='+organization+'&screen=position&level=COMPANY');
 const banner=page.locator('#corp-organization-controls');await banner.getByRole('button',{name:'Company',exact:true}).click();
 const branchPicker=banner.getByRole('combobox',{name:'Branch',exact:true});await branchPicker.locator('option[value="'+branch+'"]').waitFor({state:'attached'});await branchPicker.selectOption(branch);
 const picker=banner.getByRole('combobox',{name:'Cost center',exact:true});await picker.locator('option[value="'+center+'"]').waitFor({state:'attached'});await picker.selectOption(center);
 const section=page.locator('[data-center-statement="position"]');await section.locator('table').waitFor();
 const download=page.waitForEvent('download');await section.getByRole('button',{name:'Export center CSV',exact:true}).click();const csv=await readFile(await(await download).path(),'utf8');assert.ok(csv.includes(branch)&&csv.includes(center)&&csv.includes('20.0000'));
 assert.equal(await page.locator('[data-statement-ready]').count(),0);
 await page.screenshot({path:out+'/dated-center-branch-position.png',fullPage:true});
 // Exercise the actual future transfer command after source activity exists.
 const transferDate=sql("select (current_date+2)::text").trim();
 registry=await rpc('financial_center_branch_registry',{p_org:organization});
 const transferPayload={action:'transfer',organization,center,branch:null,from:transferDate,expectedRevision:Number(registry.revision),reason:'Prospective center reassignment preserves historical journals'};
 const postTransfer=async(payload,status)=>{const response=await page.request.post(app+'/api/financial-reporting/center-branches',{data:payload,headers:{origin:app}});const body=await response.json();assert.equal(response.status(),status,JSON.stringify(body));return body};
 await postTransfer({...transferPayload,from:'2026-01-01'},422);
 await postTransfer({...transferPayload,expectedRevision:Math.max(0,Number(registry.revision)-1)},409);
 // A foreign/missing destination must roll back closure of the prior interval.
 await postTransfer({...transferPayload,branch:randomUUID()},422);
 assert.deepEqual(await rpc('financial_center_branch_registry',{p_org:organization}),registry);
 const transferred=await postTransfer(transferPayload,201);assert.equal(transferred.revision,Number(registry.revision)+1);
 const afterRegistry=await rpc('financial_center_branch_registry',{p_org:organization});
 assert.equal(afterRegistry.assignments.filter(a=>a.centerId===center&&a.to===null).length,1);
 assert.equal(afterRegistry.assignments.find(a=>a.id===transferred.id).branchId,null);
 assert.equal(Number(sql(`select count(*) from private.financial_center_branch_transfers where organization_id='${organization}' and next_assignment='${transferred.id}'`)),1);
 const afterTransfer=await read('2026-01-01','2026-12-31');assert.deepEqual(afterTransfer.rows,full.rows);
 const afterOriginals=await actor.client.from('financial_events').select('id,entity_id,event_date').in('id',events).eq('organization_id',organization);assert.ifError(afterOriginals.error);assert.deepEqual(afterOriginals.data,originals.data);
 await writeFile(out+'/center-prospective-transfer.json',JSON.stringify({transferDate,transferred,registryBefore:registry,registryAfter:afterRegistry,sourceRowsUnchanged:true},null,2));
 await writeFile(out+'/dated-center-source.json',JSON.stringify({organization,center,branch,events,historical,full,later},null,2));
 return{organization,center,branch,events,historicalPreserved:true,branchExportVerified:true};
}
