import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
/** Disposable original-voucher acceptance. Not acquisition/goodwill accounting. */
export async function verifyGroupCapitalContribution({actor,request,rpc,command,raw,sql,parent,subsidiary,query,out}){
 const references=[];
 for(const [organization,type,debitParent,creditParent]of [[parent,'INVESTMENT','1600','2100'],[subsidiary,'EQUITY','1100','3100']]){
  const classification=randomUUID();
  sql(`insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by) values('${classification}','${organization}','QA_GROUP_CAPITAL','Documented post-control contribution','${type}','${actor.id}')`);
  let workspace=await rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:query.from});
  for(const [parentCode,normal] of [[debitParent,'DEBIT'],[creditParent,'CREDIT']]){
   if(workspace.chart.some(a=>a.reportingCode===parentCode&&a.id!==parentCode))continue;
   await rpc('save_financial_chart_account',{p_org:organization,p_code:parentCode+'98',p_parent:parentCode,p_name_ar:'حساب اختبار مساهمة رأس المال',p_name_en:'Capital contribution acceptance account',p_normal_side:normal,p_is_postable:true,p_is_active:true,p_expected_version:0,p_reason:'Prepare missing capital fixture leaf through native chart command'});
   workspace=await rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:query.from});
  }
  // Reports intentionally omit unused leaves; select new posting accounts from the full authorized chart.
  const leaf=code=>workspace.chart.find(a=>a.reportingCode===code&&a.id!==code)?.id;
  const debit=leaf(debitParent),credit=leaf(creditParent);assert.ok(debit&&credit,`Required actual leaf accounts for ${type}: ${debitParent}/${creditParent}`);
  const rules=workspace.policy.rules.map(r=>Object.fromEntries(Object.entries(r).filter(([key])=>['detailed','eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId','cashActivity'].includes(key))));
  rules.push({detailed:true,eventType:'ADJUSTMENT',sourceModule:'OPERATIONAL_CONSOLE',classificationId:classification+':BASE',cashDirection:'NON_CASH',debitAccountId:debit,creditAccountId:credit});
  const draft=await request('/api/financial-reporting/policy',{action:'save',organization,fiscalStart:query.from,expectedVersion:workspace.policy.status==='DRAFT'?workspace.policy.version:0,rules,reason:'Documented capital subscription source accounts'});
  await request('/api/financial-reporting/policy',{action:'approve',id:draft.id,expectedVersion:draft.version});
  const event=await command({action:'CREATE',payload:{organization_id:organization,entity_id:null,counterparty_id:null,event_type:'ADJUSTMENT',source_module:'OPERATIONAL_CONSOLE',source_record_id:null,source_event_key:'group-capital:'+randomUUID(),event_date:'2026-10-20',due_date:null,base_currency:'SAR',description:'Documented capital subscription after control',lines:[{line_number:1,cost_center_id:null,description:'Contributed capital',classification_id:classification,amount:25,base_amount:25,currency:'SAR',exchange_rate:1,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[],links:[]}});
  for(const status of['PLANNED','COMMITTED'])await command({action:'TRANSITION',organization_id:organization,event_id:event,status,note:'Actual contribution acceptance'});
  await command({action:'APPROVE',organization_id:organization,event_id:event,note:'Approve capital source'});
  await command({action:'TRANSITION',organization_id:organization,event_id:event,status:'ACTUAL',note:'Post capital source'});
  const original=(await raw(organization)).events.find(e=>e.id===event);assert.ok(original);
  references.push({organizationId:organization,eventId:event,lineId:original.lines[0].id,accountId:organization===parent?debit:credit});
 }
 const pair=await request('/api/financial-reporting/group-document-matches',{action:'PROPOSE',firstEventId:references[0].eventId,secondEventId:references[1].eventId,evidenceReference:'Signed parent subscription and subsidiary capital evidence',reason:'Verify same post-control capital contribution',requestId:randomUUID()});
 await request('/api/financial-reporting/group-document-matches',{action:'APPROVE',matchId:pair.documentMatchId,reason:'Actual reciprocal capital source documents verified'});
 const entry={id:randomUUID(),kind:'CAPITAL_CONTRIBUTION',documentMatchId:pair.documentMatchId,date:query.to,amount:'25',reason:'Eliminate documented post-control contributed capital',debitSource:references[1],creditSource:references[0]};
 const args={p_root:parent,p_from:query.from,p_to:query.to,p_expected_version:4,p_reason:'Reject direct SQL bypasses',p_request_id:randomUUID()};
 const bad=await actor.client.rpc('save_financial_group_eliminations',{...args,p_entries:[{...entry,amount:'26'}]});assert.match(bad.error?.message??'',/GROUP_BATCH_SOURCE_AMOUNT_EXCEEDED/);
 const reversed=await actor.client.rpc('save_financial_group_eliminations',{...args,p_request_id:randomUUID(),p_entries:[{...entry,debitSource:entry.creditSource,creditSource:entry.debitSource}]});assert.match(reversed.error?.message??'',/GROUP_BATCH_CAPITAL_CONTROL_UNSUPPORTED/);
 const before=[await raw(parent),await raw(subsidiary)];
 const batch=await request('/api/financial-reporting/group-elimination-batches',{action:'SAVE',query,entries:[entry],expectedVersion:4,reason:'Reviewed capital contribution elimination',requestId:randomUUID()});
 await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query,batchId:batch.id,expectedVersion:5,reason:'Approve verified capital contribution only'});
 const result=await request('/api/financial-reporting/group-approved-eliminations',query);
 assert.equal(result.worksheet.rows.find(r=>r.reportingCode==='3100').adjustmentDebit,'25.0000');
 assert.equal(result.worksheet.rows.find(r=>r.reportingCode==='1600').adjustmentCredit,'25.0000');
 assert.equal(result.consolidated,false);
 assert.equal(result.statementWorksheet.status,'GROUP_STATEMENT_WORKSHEET_ONLY');
 assert.equal(result.statementWorksheet.position.find(r=>r.key==='assets').adjustment,'-25.0000');
 assert.equal(result.statementWorksheet.position.find(r=>r.key==='equity').adjustment,'-25.0000');
 assert.equal(result.statementWorksheet.income.find(r=>r.key==='netProfit').adjustment,'0.0000');
 assert.ok(result.statementWorksheet.cash.every(r=>r.adjustment==='0.0000'));
 const clean=p=>{const c=structuredClone(p);delete c.coverage.readAt;return c};assert.deepEqual([await raw(parent),await raw(subsidiary)].map(clean),before.map(clean));
 await writeFile(out+'/approved-capital-contribution.json',JSON.stringify(result,null,2));
 await request('/api/financial-reporting/group-document-matches',{action:'REVOKE',matchId:pair.documentMatchId,reason:'Capital source document revocation invalidates approval'});
 await request('/api/financial-reporting/group-approved-eliminations',query,422);
}
