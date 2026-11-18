import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

export async function verifyGroupInventoryMargin({actor,request,rpc,command,sql,jointDocument,parent,subsidiary,query,out,
 acquisitionPath,approvedAcquisitionsPath,documentPath,acquisitionMeasurement,page,worksheet,positionPanel}){
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
 const date='2026-02-21';
 const replenishment={type:'ASSET',debit:'170098',credit:'210001',date:'2026-02-20',amount:800};
 const sale={type:'REVENUE',debit:'110001',credit:'410001',date,amount:1000};
 const cost={type:'OPEX',debit:'510098',credit:'170098',date,amount:800};
 const purchase={type:'ASSET',debit:'170098',credit:'210001',date,amount:1000};
 const issue={type:'OPEX',debit:'510098',credit:'170098',date:'2026-02-22',amount:100};
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
 const taxDocument=await request(documentPath,{query,subsidiary,id:randomUUID(),action:'UPLOAD',
  title:'Buyer stock tax basis and recovery-rate assessment',
  pdf:Buffer.from('%PDF-1.4\n% Disposable inventory tax evidence\n%%EOF\n').toString('base64')});
 const assessment={buyerOrganizationId:parent,saleEventId,costEventId,purchaseEventId,evidenceDocumentId:taxDocument.id,
  buyerTaxBasis:'1000',buyerRecoveryRatePercent:'20',recoverability:'PROBABLE',
  attributionTaxBasis:{sameTaxJurisdiction:true,sellerTaxRatePercent:'20.0'}};
 const taxKey={query,id:randomUUID()};
 const withTax={...payload,taxAssessmentRecordId:taxKey.id};
 const forged=await request(acquisitionPath,{...taxKey,action:'SAVE',measurement:{...acquisitionMeasurement,
  inventoryTaxAssessment:{...assessment,purchaseEventId:randomUUID()}}},422);
 assert.equal(forged.error,'GROUP_ACQUISITION_TAX_SOURCE_REQUIRED');
 const mismatchedRate=await actor.client.rpc('financial_group_acquisition_evidence_command',{
  p_action:'SAVE',p_id:taxKey.id,p_root:query.organization,p_from:query.from,p_to:query.to,p_reason:null,
  p_measurement:{...acquisitionMeasurement,inventoryTaxAssessment:{...assessment,
   attributionTaxBasis:{sameTaxJurisdiction:true,sellerTaxRatePercent:'25'}}},
 });
 assert.match(mismatchedRate.error?.message??'',/GROUP_ACQUISITION_TAX_ATTRIBUTION_RATE_MISMATCH/);
 await request(acquisitionPath,{...taxKey,action:'SAVE',measurement:{...acquisitionMeasurement,inventoryTaxAssessment:assessment}});
 assert.equal((await request(path,withTax,422)).error,'GROUP_INVENTORY_TAX_ASSESSMENT_REQUIRED');
 await request(acquisitionPath,{...taxKey,action:'APPROVE',reason:'Approve buyer basis, recovery rate and probable deductibility for this lot'});
 const taxReview=await request(path,withTax);
 assert.equal(taxReview.taxAssessmentRequired,false);
 assert.equal(taxReview.issuanceReady,false);
 assert.deepEqual(taxReview.deferredTax,{
  approvedRecordId:taxKey.id,evidenceDocumentId:taxDocument.id,
  buyerTaxBasis:'1000.0000',consolidatedInventoryCarryingAmount:'800.0000',deductibleTemporaryDifference:'200.0000',
  buyerRecoveryRatePercent:'20',recoverability:'PROBABLE',deferredTaxAssetIncrease:'40.0000',
  unrecognizedDeferredTaxAsset:'0.0000',groupAfterTaxProfitReduction:'160.0000',
 });
 assert.deepEqual(taxReview.illustrativePretaxAttribution,result.illustrativePretaxAttribution);
 assert.deepEqual(taxReview.afterTaxAttribution,{
  parent:'128.0000',nonControllingInterests:'32.0000',attributionTaxBasis:assessment.attributionTaxBasis,
 });
 const batchPath='/api/financial-reporting/group-elimination-batches';
 const batch=await request(batchPath,{action:'SAVE',query,entries:[],expectedVersion:0,requestId:randomUUID(),
  reason:'Approve the period before applying the separately documented inventory elimination'});
 await request(batchPath,{action:'APPROVE',query,batchId:batch.id,expectedVersion:1,reason:'Approve the exact report period'});
 const positionAction={action:'ACQUISITION_POSITION',query};
 const before=await request(approvedAcquisitionsPath,positionAction);
 assert.equal(before.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(before));
 assert.equal(before.inventoryEliminations.length,0);
 const originalBooks=()=>Promise.all([parent,subsidiary].map(async organization=>{
  const snapshot=await rpc('financial_statement_live_snapshot',{p_org:organization,p_from:query.from,p_to:query.to});
  delete snapshot.coverage.readAt;
  return snapshot;
 }));
 const booksBefore=await originalBooks();
 await request(acquisitionPath,{...taxKey,action:'REVOKE',reason:'Verify withdrawn tax approval is rejected by the stock review'});
 assert.equal((await request(path,withTax,422)).error,'GROUP_INVENTORY_TAX_ASSESSMENT_REQUIRED');
 await writeFile(out+'/group-inventory-deferred-tax-review.json',JSON.stringify(taxReview,null,2));
 console.log('PASS Approved same-rate inventory tax assessment reconciles after-tax parent and NCI attribution');
 const eliminationKey={query,id:randomUUID()};
 const withMatches=eliminationDocumentMatches=>({...acquisitionMeasurement,inventoryTaxAssessment:{...assessment,
  eliminationDocumentMatches}});
 const wrongMatch=await request(acquisitionPath,{...eliminationKey,action:'SAVE',measurement:withMatches({
  saleDocumentMatchId:costDocumentMatchId,costDocumentMatchId:saleDocumentMatchId,
 })},422);
 assert.equal(wrongMatch.error,'GROUP_ACQUISITION_INVENTORY_DOCUMENT_MISMATCH');
 await request(acquisitionPath,{...eliminationKey,action:'SAVE',measurement:withMatches({saleDocumentMatchId,costDocumentMatchId})});
 await request(acquisitionPath,{...eliminationKey,action:'APPROVE',reason:'Approve the inventory elimination in the group statements'});
 const after=await request(approvedAcquisitionsPath,positionAction);
 assert.equal(after.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(after));
 assert.equal(after.inventoryEliminations.length,1);
 function difference(field,key){
  return Number(after[field].find(row=>row.key===key).after)-Number(before[field].find(row=>row.key===key).after);
 }
 for(const [key,amount] of [['revenue',-1000],['costOfSales',-800],['grossProfit',-200],['operatingProfit',-200],['tax',-40],['netProfit',-160]])
  assert.equal(difference('income',key),amount);
 assert.equal(difference('rows','assets'),-160);
 assert.equal(difference('rows','liabilities'),0);
 assert.equal(difference('rows','equity'),-160);
 assert.equal(Number(after.closingNci)-Number(before.closingNci),-32);
 assert.equal(Number(after.closingParentEquity)-Number(before.closingParentEquity),-128);
 assert.deepEqual(after.cash,before.cash);
 assert.deepEqual(await originalBooks(),booksBefore);
 await page.getByLabel('To date',{exact:true}).fill(query.to);
 await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
 await positionPanel.getByRole('heading',{name:'Approved inventory margin eliminations',exact:true}).waitFor();
 await positionPanel.getByText('170098',{exact:true}).waitFor();
 const exportButton=positionPanel.getByRole('button',{name:'Export adjusted group statements CSV',exact:true});
 const download=page.waitForEvent('download');
 await exportButton.click();
 const file=await download;
 assert.equal(file.suggestedFilename(),`group-adjusted-statements-${query.organization}-${query.from}-${query.to}-v1.csv`);
 const csvPath=out+'/group-adjusted-statements.csv';
 await file.saveAs(csvPath);
 const csv=await readFile(csvPath,'utf8');
 for(const [section,english,arabic,key,source] of [
  ['position','Assets','الأصول','assets',after.rows],
  ['income','Net profit','صافي الربح','netProfit',after.income],
  ['cash','Closing cash','النقد آخر الفترة','closing',after.statementCash],
 ]){
  const row=source.find(item=>item.key===key);
  assert.ok(csv.includes([section,english,arabic,row.before,row.adjustment,row.after].map(value=>'"'+value+'"').join(',')));
 }
 assert.ok(csv.includes('"170098","200.0000","40.0000","160.0000","128.0000","32.0000"'));
 await writeFile(out+'/group-inventory-consolidated-position.json',JSON.stringify({before,after},null,2));
 console.log('PASS Approved stock margin reaches group position, income and non-controlling interests exactly once');
 await buyer(issue);
 let extraDownloads=0;
 const countDownload=()=>extraDownloads++;
 page.on('download',countDownload);
 try{
  await exportButton.click();
  await positionPanel.getByText('Verified acquisition-day adjustments are unavailable for this selection.',{exact:true}).waitFor();
  assert.equal(extraDownloads,0);
 }finally{page.off('download',countDownload);}
 console.log('PASS Browser exports exact adjusted statements and withholds the download when stock evidence changes');
 assert.equal((await request(path,payload,422)).error,'GROUP_INVENTORY_REMAINING_STOCK_UNVERIFIED');
 assert.equal((await request(approvedAcquisitionsPath,positionAction,409)).error,'GROUP_BATCH_SOURCE_CHANGED');
 const refreshedBatch=await request(batchPath,{action:'SAVE',query,entries:[],expectedVersion:1,requestId:randomUUID(),
  reason:'Confirm that refreshing the group batch cannot revive stale inventory evidence'});
 await request(batchPath,{action:'APPROVE',query,batchId:refreshedBatch.id,expectedVersion:2,
  reason:'Approve the group batch based on the changed stock ledger'});
 const invalidated=await request(approvedAcquisitionsPath,positionAction,422);
 assert.equal(invalidated.error,'GROUP_INVENTORY_REMAINING_STOCK_UNVERIFIED');
 await writeFile(out+'/group-inventory-margin-review.json',JSON.stringify(result,null,2));
 console.log('PASS Posted stock transfer proves the unsold margin and rejects partial inventory movement');
}
