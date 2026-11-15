import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

export async function verifyGroupInventoryMargin({actor,request,rpc,command,sql,jointDocument,parent,subsidiary,query,out}){
 async function prepare(organization,entries){
  let workspace=await rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:query.from});
  for(const code of new Set(entries.flatMap(entry=>[entry.debit,entry.credit]))){
   if(workspace.chart.some(account=>account.id===code))continue;
   const root=code.slice(0,4);
   await rpc('save_financial_chart_account',{p_org:organization,p_code:code,p_parent:root,p_name_ar:'حساب اختبار المخزون',
    p_name_en:'Inventory transfer acceptance account',p_normal_side:['2100','4100'].includes(root)?'CREDIT':'DEBIT',
    p_is_postable:true,p_is_active:true,p_expected_version:0,p_reason:'Prepare the inventory acceptance posting accounts'});
   workspace=await rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:query.from});
  }
  const rules=workspace.policy.rules.map(rule=>Object.fromEntries(Object.entries(rule).filter(([key])=>
   ['detailed','eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId','cashActivity'].includes(key))));
  for(const entry of entries){
   entry.classification=randomUUID();
   sql(`insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by)
    values('${entry.classification}','${organization}','QA_STOCK_${entry.classification}','Inventory transfer acceptance','${entry.type}','${actor.id}')`);
   rules.push({detailed:true,eventType:'ADJUSTMENT',sourceModule:'OPERATIONAL_CONSOLE',classificationId:entry.classification+':BASE',
    cashDirection:'NON_CASH',debitAccountId:entry.debit,creditAccountId:entry.credit});
  }
  const policy=await request('/api/financial-reporting/policy',{action:'save',organization,fiscalStart:query.from,
   expectedVersion:workspace.policy.status==='DRAFT'?workspace.policy.version:0,rules,reason:'Inventory transfer acceptance accounts'});
  await request('/api/financial-reporting/policy',{action:'approve',id:policy.id,expectedVersion:policy.version});
  return async({classification,date,amount})=>{
   const id=await command({action:'CREATE',payload:{organization_id:organization,entity_id:null,counterparty_id:null,
    event_type:'ADJUSTMENT',source_module:'OPERATIONAL_CONSOLE',source_event_key:'group-inventory:'+randomUUID(),
    event_date:date,due_date:null,base_currency:'SAR',description:'Documented stock transfer acceptance',
    lines:[{line_number:1,cost_center_id:null,description:'Inventory transfer source',classification_id:classification,
     amount,base_amount:amount,currency:'SAR',exchange_rate:1,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],
    obligations:[],links:[],
   }});
   for(const status of ['PLANNED','COMMITTED'])
    await command({action:'TRANSITION',organization_id:organization,event_id:id,status,note:'Submit inventory source voucher'});
   await command({action:'APPROVE',organization_id:organization,event_id:id,note:'Approve inventory source voucher'});
   await command({action:'TRANSITION',organization_id:organization,event_id:id,status:'ACTUAL',note:'Post inventory source voucher'});
   return id;
  };
 }
 const date='2026-11-05';
 const replenishment={type:'ASSET',debit:'170098',credit:'210001',date:'2026-11-04',amount:800};
 const sale={type:'REVENUE',debit:'110001',credit:'410001',date,amount:1000};
 const cost={type:'OPEX',debit:'510098',credit:'170098',date,amount:800};
 const purchase={type:'ASSET',debit:'170098',credit:'210001',date,amount:1000};
 const issue={type:'OPEX',debit:'510098',credit:'170098',date:'2026-11-06',amount:100};
 const seller=await prepare(subsidiary,[replenishment,sale,cost]);
 const buyer=await prepare(parent,[purchase,issue]);
 await seller(replenishment);
 const saleEventId=await seller(sale),costEventId=await seller(cost),purchaseEventId=await buyer(purchase);
 const saleDocumentMatchId=await jointDocument(saleEventId,purchaseEventId);
 const costDocumentMatchId=await jointDocument(costEventId,purchaseEventId);
 const payload={action:'REVIEW_INVENTORY_MARGIN',query,sellerOrganizationId:subsidiary,buyerOrganizationId:parent,
  saleEventId,costEventId,purchaseEventId,saleDocumentMatchId,costDocumentMatchId};
 const path='/api/financial-reporting/group-eliminations';
 const result=await request(path,payload);
 assert.equal(result.status,'INVENTORY_MARGIN_REVIEW_ONLY');
 assert.equal(result.inventoryReduction,'200.0000');
 assert.deepEqual(result.illustrativePretaxAttribution,{parent:'160.0000',nonControllingInterests:'40.0000'});
 assert.equal(result.taxAssessmentRequired,true);
 assert.equal(result.issuanceReady,false);
 await buyer(issue);
 assert.equal((await request(path,payload,422)).error,'GROUP_INVENTORY_REMAINING_STOCK_UNVERIFIED');
 await writeFile(out+'/group-inventory-margin-review.json',JSON.stringify(result,null,2));
 console.log('PASS Posted stock transfer proves the unsold margin and rejects partial inventory movement');
}
