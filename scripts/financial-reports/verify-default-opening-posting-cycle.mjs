import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

// Genuine loopback Auth/API/database/browser acceptance. No mocked business API
// or manually inserted financial events, rules, movements or settlements.
export async function verifyDefaultPostingActualCycle({actor,outsider,page,app,out,sql,databaseUrl}){
 assert.equal(databaseUrl,'http://127.0.0.1:54321','DISPOSABLE_DATABASE_REQUIRED');
 assert.equal(new URL(app).hostname,'localhost','LOOPBACK_APPLICATION_REQUIRED');
 const organization=randomUUID(),scope={p_org:organization,p_fiscal_start:'2026-01-01'};
 const evidence={kind:'REAL_DISPOSABLE_AUTH_API_DATABASE_BROWSER',organization,stages:[],journals:[],duplicateRetries:[],screenshots:[]};
 const unwrap=r=>{assert.ifError(r.error);return r.data;};
 const rpc=async(name,args)=>unwrap(await actor.client.rpc(name,args));
 const request=async(method,path,body,expected=200)=>{
  const response=await page.request[method](app+path,{...(body?{data:body}:{}),headers:{origin:app}});
  const data=await response.json();assert.equal(response.status(),expected,method+' '+path+' '+JSON.stringify(data));return data;
 };
 sql(`select set_config('request.jwt.claim.sub','${actor.id}',false);
 insert into public.organizations(id,owner_user_id,name) values('${organization}','${actor.id}','ZZ Default rules actual cycle');
 insert into public.organization_members(organization_id,user_id,role,status) values('${organization}','${actor.id}','OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';`);
 await rpc('save_financial_fiscal_calendar',{p_org:organization,p_month:1,p_day:1,p_retained:'3300',p_expected_version:0,p_reason:'Actual default posting cycle calendar'});
 for(const [code,parent,ar,en,normal] of [['610001','6100','مصروفات تشغيل الاختبار','Cycle operating expenses','DEBIT'],['410001','4100','إيرادات خدمات الاختبار','Cycle service revenue','CREDIT']])
  await rpc('save_financial_chart_account',{p_org:organization,p_code:code,p_parent:parent,p_name_ar:ar,p_name_en:en,p_normal_side:normal,p_is_active:true,p_is_postable:true,p_expected_version:0,p_reason:'Organization-specific default account'});
 const bankResult=await request('post','/api/liquidity',{kind:'account',organization_id:organization,request_id:randomUUID(),name:'بنك تجربة القواعد',account_type:'BANK',currency:'SAR',balance_mode:'OPENING',opening_date:'2025-12-31',fx_rate:1,current_balance:5000,current_balance_base:5000},201);
 // The account command returns a scoped native account descriptor.
 const bankId=bankResult.account_id??bankResult.id;
 assert.ok(bankId,'BANK_ID_REQUIRED');
 const opening=await rpc('financial_opening_workspace',scope);
 const entries=Object.fromEntries(opening.source.rows.filter(row=>row.vouchers.length===0).map(row=>[row.id,{amount:'0',side:row.normal}]));
 entries['equity:3100']={amount:'5000',side:'CREDIT'};
 const draft=await rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:opening.source.revision,p_entries:entries,p_reason:'Actual cycle: source bank 5000 equals capital 5000'});
 await rpc('approve_financial_opening',{p_id:draft.id,p_expected_version:draft.version});
 // Reproduce the existing QA tenant: approved empty policy, no classifications,
 // no actual operations. Recovery must create a distinct draft, never alter approval.
 const legacy=await rpc('save_financial_reporting_policy',{...scope,p_expected_version:0,p_rules:[],p_reason:'Legacy zero-activity approved policy regression'});
 await rpc('approve_financial_reporting_policy',{p_id:legacy.id,p_expected_version:legacy.version});
 const legacyBefore=unwrap(await actor.client.from('financial_reporting_policies').select('*').eq('id',legacy.id).single());
 assert.equal(legacyBefore.status,'APPROVED');assert.deepEqual(legacyBefore.rules,[]);
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1490,height:1050});
 await page.goto(app+'/ar/settings/financial?organization='+organization);
 await page.getByRole('button',{name:'قواعد الترحيل',exact:true}).first().click();
 await page.getByRole('region',{name:'القواعد الافتراضية',exact:true}).waitFor();
 await page.getByLabel('الحساب المدين 1',{exact:true}).waitFor();
 const policyBefore=await rpc('financial_reporting_policy_workspace',scope);
 assert.equal(policyBefore.events.length,0);assert.equal(policyBefore.policy.status,'DRAFT');assert.ok(policyBefore.policy.rules.length>0);
 assert.notEqual(policyBefore.policy.id,legacy.id);
 assert.deepEqual(unwrap(await actor.client.from('financial_reporting_policies').select('*').eq('id',legacy.id).single()),legacyBefore,'Recovery leaves the approved record unchanged');
 evidence.legacyRecovery={approvedPolicyId:legacy.id,draftPolicyId:policyBefore.policy.id,ruleCount:policyBefore.policy.rules.length,events:0,priorApprovedUnchanged:true};

 const classifications=unwrap(await actor.client.from('financial_classifications').select('id,classification_type').eq('organization_id',organization));
 const classification=type=>{const c=classifications.find(c=>c.classification_type===type);assert.ok(c,type+' classification');return c.id;};
 const proposed=(eventType,type,direction)=>{const r=policyBefore.policy.rules.find(r=>r.eventType===eventType&&r.sourceModule==='OPERATIONAL_CONSOLE'&&r.classificationId===classification(type)+':BASE'&&r.cashDirection===direction);assert.ok(r,type+' default rule');return r;};
 const expenseRule=proposed('EXPENSE','OPEX','NON_CASH'),incomeRule=proposed('REVENUE','REVENUE','NON_CASH');
 assert.equal(expenseRule.debitAccountId,'610001');assert.equal(incomeRule.creditAccountId,'410001');
 const saveBefore=await request('post','/api/financial-reporting/policy',{action:'initialize-defaults',organization,fiscalStart:'2026-01-01'});
 assert.equal(saveBefore.policy.version,policyBefore.policy.version);assert.deepEqual(saveBefore.policy.rules,policyBefore.policy.rules);
 await page.getByRole('button',{name:'اعتماد القواعد',exact:true}).click();
 await page.getByRole('button',{name:'إعداد نسخة جديدة',exact:true}).waitFor();
 const approved=await rpc('financial_reporting_policy_workspace',scope);assert.equal(approved.policy.status,'APPROVED');
 const policyFingerprint=JSON.stringify(approved.policy.rules);
 const shot=async label=>{await page.evaluate(()=>document.fonts.ready);const name='default-actual-cycle-'+label+'.png';await page.screenshot({path:out+'/'+name,fullPage:true});evidence.screenshots.push(name);};
 await shot('rules-before-operations');
 const expectedIds=[];
 async function observe(stage,{cash,expense,revenue,receivable,payable}){
  const data=await request('get','/api/financial-reporting/live-statements?'+new URLSearchParams({action:'statements',organization,from:'2026-01-01',to:'2026-12-31'}));
  assert.equal(data.origin,'LIVE_CANONICAL_EVENTS');const s=data.statements;
  assert.equal(Number(s.cash.closing),cash);assert.equal(Number(s.income.operatingExpenses),expense);assert.equal(Number(s.income.revenue),revenue);assert.equal(Number(s.income.netProfit),revenue-expense);
  assert.equal(Number(data.accounts.find(a=>a.id==='1100')?.balance??0),receivable);
  assert.equal(Number(data.accounts.find(a=>a.id==='2100')?.balance??0)+payable,0);
  assert.equal(Number(s.position.assets),cash+receivable);assert.equal(Number(s.position.liabilities),payable);assert.equal(Number(s.position.equity),5000+revenue-expense);
  assert.deepEqual(new Set(s.sourceJournalIds),new Set(expectedIds));assert.equal(s.sourceJournalIds.length,expectedIds.length);assert.equal(data.lineage.length,expectedIds.length);
  const actualBank=unwrap(await actor.client.from('liquidity_accounts').select('current_balance').eq('organization_id',organization).eq('id',bankId).single());assert.equal(Number(actualBank.current_balance),cash);
  const policy=await rpc('financial_reporting_policy_workspace',scope);assert.equal(policy.policy.status,'APPROVED');assert.equal(JSON.stringify(policy.policy.rules),policyFingerprint,'Operations cannot rewrite approved default rules');
  const stageResult={stage,cash:Number(s.cash.closing),revenue:Number(s.income.revenue),expense:Number(s.income.operatingExpenses),netProfit:Number(s.income.netProfit),receivable,payable,journalCount:s.sourceJournalIds.length};evidence.stages.push(stageResult);
  await writeFile(out+'/default-posting-actual-cycle-'+stage+'.json',JSON.stringify(data,null,2)+'\n');return data;
 }
 await observe('opening',{cash:5000,expense:0,revenue:0,receivable:0,payable:0});
 const supplier=await request('post','/api/liquidity',{kind:'counterparty',organization_id:organization,name:'مورد تجربة القواعد',party_type:'SUPPLIER'},201);
 const customer=await request('post','/api/liquidity',{kind:'counterparty',organization_id:organization,name:'عميل تجربة القواعد',party_type:'CUSTOMER'},201);
 async function prepareFlow(type,direction,amount,date,party){
  const category=await request('post','/api/liquidity',{kind:'category',organization_id:organization,name_ar:type==='OPEX'?'مصروف الاختبار':'إيراد الاختبار',name_en:'Actual cycle '+type,flow_group:'OPERATING',accounting_group:type==='OPEX'?'EXPENSE':'REVENUE',treatment_code:type==='OPEX'?'OPERATING_EXPENSE':'SERVICE_REVENUE',allowed_direction:direction,financial_classification_type:type},201);
  const flow=await request('post','/api/liquidity',{kind:'flow',organization_id:organization,account_id:bankId,category_id:category.id,direction,title:'Actual default cycle '+type,counterparty_id:party.id,due_date:date,amount,base_amount:amount,currency:'SAR',status:'EXPECTED',source:'MANUAL'},201);
  const confirmed=await request('patch','/api/liquidity/'+flow.id,{status:'CONFIRMED'});assert.ok(confirmed.recognition_event_id);
  const id=confirmed.recognition_event_id;
  const args={organization_id:organization,event_id:id};
  // Before approval the native API must reject posting a real event.
  await request('post','/api/financial-events',{action:'TRANSITION',...args,status:'ACTUAL',note:'Must require approval'},400);
  await request('post','/api/financial-events',{action:'APPROVE',...args,note:'Actual cycle approval'});
  await request('post','/api/financial-events',{action:'TRANSITION',...args,status:'ACTUAL',note:'Actual cycle recognition'});
  expectedIds.push(id);const mapping=type==='OPEX'?expenseRule:incomeRule;evidence.journals.push({id,type:type==='REVENUE'?'REVENUE':'EXPENSE',source:'OPERATIONAL_CONSOLE',flowId:flow.id,amount,debitAccount:mapping.debitAccountId,creditAccount:mapping.creditAccountId});return flow;
 }
 const expenseFlow=await prepareFlow('OPEX','OUTFLOW',1000,'2026-03-01',supplier);
 await observe('expense-recognized',{cash:5000,expense:1000,revenue:0,receivable:0,payable:1000});
 async function settle(flow,amount,date){
  const payload={status:'ACTUAL',request_id:randomUUID(),account_id:bankId,amount,base_amount:amount,settlement_date:date};
  const posted=await request('patch','/api/liquidity/'+flow.id,payload);assert.ok(posted.settlement_event_id);expectedIds.push(posted.settlement_event_id);
  const counts=Number(sql(`select count(*) from public.liquidity_settlements where organization_id='${organization}'`));
  const replay=await request('patch','/api/liquidity/'+flow.id,payload);assert.equal(replay.settlement_event_id,posted.settlement_event_id);
  assert.equal(Number(sql(`select count(*) from public.liquidity_settlements where organization_id='${organization}'`)),counts);
  evidence.duplicateRetries.push({eventId:posted.settlement_event_id,prevented:true});const isReceipt=flow.direction==='INFLOW';const mapping=proposed('SETTLEMENT',isReceipt?'RECEIVABLE':'PAYABLE',isReceipt?'INFLOW':'OUTFLOW');evidence.journals.push({id:posted.settlement_event_id,type:'SETTLEMENT',flowId:flow.id,amount,debitAccount:mapping.debitAccountId,creditAccount:mapping.creditAccountId});return {...posted,replayPayload:payload};
 }
 await settle(expenseFlow,1000,'2026-03-02');
 await observe('expense-paid',{cash:4000,expense:1000,revenue:0,receivable:0,payable:0});
 const incomeFlow=await prepareFlow('REVENUE','INFLOW',2500,'2026-03-03',customer);
 await observe('revenue-recognized',{cash:4000,expense:1000,revenue:2500,receivable:2500,payable:0});
 await settle(incomeFlow,2500,'2026-03-04');
 const final=await observe('revenue-collected',{cash:6500,expense:1000,revenue:2500,receivable:0,payable:0});
 assert.equal(Number(final.statements.cash.operating),1500);assert.equal(Number(final.statements.cash.opening),5000);
 const incompatibleCategory=await request('post','/api/liquidity',{kind:'category',organization_id:organization,name_ar:'اختبار رفض عدم تطابق الطرف',name_en:'Party mismatch rejection',flow_group:'OPERATING',accounting_group:'REVENUE',treatment_code:'SERVICE_REVENUE',allowed_direction:'INFLOW',financial_classification_type:'REVENUE'},201);
 const incompatibleFlow=await request('post','/api/liquidity',{kind:'flow',organization_id:organization,account_id:bankId,category_id:incompatibleCategory.id,direction:'INFLOW',title:'Must reject supplier revenue',counterparty_id:supplier.id,due_date:'2026-03-05',amount:10,base_amount:10,currency:'SAR',status:'EXPECTED',source:'MANUAL'},201);
 const mismatch=await request('patch','/api/liquidity/'+incompatibleFlow.id,{status:'CONFIRMED'},409);assert.equal(mismatch.error,'COUNTERPARTY_ACCOUNTING_CLASSIFICATION_MISMATCH');evidence.counterpartyMismatchDenied=true;
 assert.equal(Number(sql(`select count(*) from public.financial_events where organization_id='${organization}'`)),4,'Rejected party mismatch cannot create a financial event');

 assert.equal(Number(sql(`select count(*) from public.financial_events where organization_id='${organization}' and status='ACTUAL'`)),4);
 assert.equal(Number(sql(`select count(*) from public.liquidity_settlements where organization_id='${organization}' and status='POSTED'`)),2);
 const balances=unwrap(await actor.client.from('financial_event_obligation_balances').select('outstanding_base_amount').eq('organization_id',organization));assert.equal(balances.length,2);assert.ok(balances.every(b=>Number(b.outstanding_base_amount)===0));
 assert.ok((await outsider.client.rpc('financial_statement_live_snapshot',{p_org:organization,p_from:'2026-01-01',p_to:'2026-12-31'})).error);
 evidence.crossTenantDenied=true;evidence.rulesUnchanged=true;evidence.final={income:final.statements.income,cash:final.statements.cash,position:final.statements.position};
 // Follow the completed baseline with genuinely partial settlements. Recognition
 // must happen once, while cash and the outstanding obligation change per payment.
 const partialExpense=await prepareFlow('OPEX','OUTFLOW',600,'2026-04-01',supplier);
 await observe('partial-expense-recognized',{cash:6500,expense:1600,revenue:2500,receivable:0,payable:600});
 const expenseFirst=await settle(partialExpense,200,'2026-04-02');
 assert.equal(expenseFirst.settlement_status,'PARTIAL');
 await observe('partial-expense-paid-200',{cash:6300,expense:1600,revenue:2500,receivable:0,payable:400});
 const eventCount=()=>Number(sql(`select count(*) from public.financial_events where organization_id='${organization}'`));
 const beforeRejected=eventCount();
 await request('patch','/api/liquidity/'+partialExpense.id,{...expenseFirst.replayPayload,amount:201,base_amount:201},400);
 await request('patch','/api/liquidity/'+partialExpense.id,{status:'ACTUAL',request_id:randomUUID(),account_id:bankId,amount:401,base_amount:401,settlement_date:'2026-04-03'},400);
 await request('patch','/api/liquidity/'+partialExpense.id,{status:'ACTUAL',request_id:randomUUID(),account_id:bankId,amount:100,base_amount:99,settlement_date:'2026-04-03'},400);
 assert.equal(eventCount(),beforeRejected,'Rejected settlement instructions cannot create financial events');
 await observe('partial-expense-invalid-requests-rejected',{cash:6300,expense:1600,revenue:2500,receivable:0,payable:400});
 const expenseLast=await settle(partialExpense,400,'2026-04-04');assert.equal(expenseLast.settlement_status,'SETTLED');
 await observe('partial-expense-paid-600',{cash:5900,expense:1600,revenue:2500,receivable:0,payable:0});
 const partialIncome=await prepareFlow('REVENUE','INFLOW',1200,'2026-04-05',customer);
 await observe('partial-revenue-recognized',{cash:5900,expense:1600,revenue:3700,receivable:1200,payable:0});
 const incomeFirst=await settle(partialIncome,400,'2026-04-06');assert.equal(incomeFirst.settlement_status,'PARTIAL');
 await observe('partial-revenue-collected-400',{cash:6300,expense:1600,revenue:3700,receivable:800,payable:0});
 const incomeLast=await settle(partialIncome,800,'2026-04-07');assert.equal(incomeLast.settlement_status,'SETTLED');
 const partialFinal=await observe('partial-revenue-collected-1200',{cash:7100,expense:1600,revenue:3700,receivable:0,payable:0});
 assert.equal(eventCount(),10);assert.equal(Number(sql(`select count(*) from public.financial_events where organization_id='${organization}' and status='ACTUAL'`)),10);
 assert.equal(Number(sql(`select count(*) from public.liquidity_settlements where organization_id='${organization}' and status='POSTED'`)),6);
 const finalObligations=unwrap(await actor.client.from('financial_event_obligation_balances').select('outstanding_base_amount').eq('organization_id',organization));assert.equal(finalObligations.length,4);assert.ok(finalObligations.every(b=>Number(b.outstanding_base_amount)===0));
 evidence.partialSettlementGuards={changedReplayDenied:true,overpaymentDenied:true,inconsistentBaseDenied:true};
 evidence.finalWithPartialSettlements={income:partialFinal.statements.income,cash:partialFinal.statements.cash,position:partialFinal.statements.position};
 // Open the report against real APIs in both locales after the transactions.
 for(const locale of ['ar','en'])for(const width of [1490,390]){
  await page.setViewportSize({width,height:1050});await page.goto(app+'/'+locale+'/financial-reports?organization='+organization+'&screen=income');
  await page.locator('[data-statement-ready="income"]').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const income=await page.locator('[data-statement-ready="income"]').innerText();assert.match(income,/3,700\.00/);assert.match(income,/1,600\.00/);assert.match(income,/2,100\.00/);
  await shot(locale+'-income-'+width);
 }
 await writeFile(out+'/default-posting-actual-cycle.json',JSON.stringify(evidence,null,2)+'\n');
 return evidence;
}
