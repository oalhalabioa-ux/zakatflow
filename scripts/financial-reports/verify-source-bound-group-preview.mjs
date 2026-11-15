import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
/** Disposable only: actual source vouchers, approved control and server preview.
 * A passing preview is NOT approval of documentary pairing or final consolidation. */
export async function verifySourceBoundGroupPreview({actor,page,app,out,sql,databaseUrl,subsidiary,expenseEvent}){
 assert.equal(databaseUrl,'http://127.0.0.1:54321');assert.equal(new URL(app).hostname,'localhost');
 const parent=randomUUID(),rpc=async(name,args)=>{const r=await actor.client.rpc(name,args);assert.ifError(r.error);return r.data};
 const request=async(path,data,expected=200)=>{const r=await page.request.post(app+path,{data,headers:{origin:app}});const body=await r.json();assert.equal(r.status(),expected,JSON.stringify(body));return body};
 sql(`select set_config('request.jwt.claim.sub','${actor.id}',false);
 insert into public.organizations(id,owner_user_id,name) values('${parent}','${actor.id}','Source-bound group parent');
 insert into public.organization_members(organization_id,user_id,role,status) values('${parent}','${actor.id}','OWNER','ACTIVE');
 update public.organizations set parent_organization_id='${parent}' where id='${subsidiary}';`);
 await rpc('save_financial_fiscal_calendar',{p_org:parent,p_month:1,p_day:1,p_retained:'3300',p_expected_version:0,p_reason:'Group preview acceptance calendar'});
 const bank=await request('/api/liquidity',{kind:'account',organization_id:parent,request_id:randomUUID(),name:'Group parent bank',account_type:'BANK',currency:'SAR',balance_mode:'OPENING',opening_date:'2025-12-31',fx_rate:1,current_balance:500,current_balance_base:500},201);
 const bankId=bank.account_id??bank.id;assert.ok(bankId);await rpc('link_financial_cash_accounts',{p_org:parent});
 const scope={p_org:parent,p_fiscal_start:'2026-01-01'},opening=await rpc('financial_opening_workspace',scope);
 const entries=Object.fromEntries(opening.source.rows.filter(r=>r.vouchers.length===0).map(r=>[r.id,{amount:'0',side:r.normal}]));
 for(const [id,accountCode]of Object.entries(opening.cashAccountCodes??{}))if(opening.source.rows.some(r=>r.id===id))entries[id]={amount:entries[id]?.amount??'',side:entries[id]?.side??'DEBIT',accountCode};
 entries['equity:3100']={amount:'500',side:'CREDIT'};
 const draft=await rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:opening.source.revision,p_entries:entries,p_reason:'Source bank equals original capital'});
 await rpc('approve_financial_opening',{p_id:draft.id,p_expected_version:draft.version});
 await request('/api/financial-reporting/policy',{action:'activate-defaults',organization:parent,fiscalStart:'2026-01-01'});
 const classification=await actor.client.from('financial_classifications').select('id').eq('organization_id',parent).eq('code','REVENUE').single();assert.ifError(classification.error);
 const command=async data=>(await request('/api/financial-events',data)).result;
 const revenue=await command({action:'CREATE',payload:{organization_id:parent,entity_id:null,counterparty_id:null,event_type:'REVENUE',source_module:'OPERATIONAL_CONSOLE',source_record_id:null,source_event_key:'group-revenue:'+randomUUID(),event_date:'2026-10-01',due_date:'2026-10-01',base_currency:'SAR',description:'Group counterpart source voucher',lines:[{line_number:1,cost_center_id:null,description:'Group service',classification_id:classification.data.id,amount:60,base_amount:60,currency:'SAR',exchange_rate:1,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[{obligation_key:'group-receivable',obligation_type:'RECEIVABLE',settleable_amount:60,currency:'SAR',exchange_rate:1,base_currency:'SAR',settleable_base_amount:60}],links:[]}});
 for(const status of ['PLANNED','COMMITTED'])await command({action:'TRANSITION',organization_id:parent,event_id:revenue,status,note:'Group preview source'});
 await command({action:'APPROVE',organization_id:parent,event_id:revenue,note:'Approve source voucher'});await command({action:'TRANSITION',organization_id:parent,event_id:revenue,status:'ACTUAL',note:'Post source voucher'});
 const control=await rpc('financial_group_control_propose',{p_parent:parent,p_subsidiary:subsidiary,p_from:'2026-01-01',p_to:null,p_economic:100,p_voting:100,p_basis:'VOTING',p_evidence_reference:'Disposable signed control fixture',p_reason:'Complete group evidence for isolated acceptance',p_request_id:randomUUID()});
 await rpc('financial_group_control_approve',{p_assessment:control,p_reason:'Verify both companies in disposable test'});
 const query={organization:parent,from:'2026-01-01',to:'2026-12-31'};
 const raw=async organization=>rpc('financial_statement_live_snapshot',{p_org:organization,p_from:query.from,p_to:query.to});
 const p=await raw(parent),s=await raw(subsidiary),rline=p.events.find(e=>e.id===revenue).lines[0],eline=s.events.find(e=>e.id===expenseEvent).lines.find(l=>Number(l.baseAmount)===60);assert.ok(eline);
 const acquisitionInput={query,measurement:{parentOrganizationId:parent,subsidiaryOrganizationId:subsidiary,currency:'SAR',acquisitionDate:'2026-01-01',transactionType:'SINGLE_STEP_BUSINESS_COMBINATION',commonControl:false,instruments:'ORDINARY_PROPORTIONATE',consideration:'1200',considerationEvidence:'Unapproved consideration review fixture',identifiableItems:[{id:'assets',kind:'ASSET',recognizedAmount:'1500',measurementEvidence:'Unapproved asset valuation fixture'},{id:'liabilities',kind:'LIABILITY',recognizedAmount:'500',measurementEvidence:'Unapproved liability valuation fixture'}],nci:{method:'PROPORTIONATE_NET_ASSETS'}}};
 const acquisitionReview=await request('/api/financial-reporting/group-acquisition-review',acquisitionInput);
 assert.equal(acquisitionReview.status,'UNAPPROVED_ACQUISITION_REVIEW');assert.equal(acquisitionReview.evidenceVerified,false);assert.equal(acquisitionReview.persisted,false);assert.equal(acquisitionReview.issuanceReady,false);
 assert.equal(acquisitionReview.calculation.goodwill,'200.0000');assert.equal(acquisitionReview.calculation.nciAtAcquisition,'0.0000');
 await request('/api/financial-reporting/group-acquisition-review',{...acquisitionInput,approved:true},400);
 await request('/api/financial-reporting/group-acquisition-review',{...acquisitionInput,measurement:{...acquisitionInput.measurement,currency:'USD'}},422);
 await writeFile(out+'/unapproved-acquisition-review.json',JSON.stringify(acquisitionReview,null,2));
 const acquisitionPath='/api/financial-reporting/group-acquisition-review';
 const acquisitionKey={query,id:randomUUID()};
 const documentPath='/api/financial-reporting/group-acquisition-documents';
 const documentKey={query,subsidiary,id:randomUUID()};
 const pdf=Buffer.from('%PDF-1.4\n% Disposable acquisition evidence\n%%EOF\n');
 const upload={...documentKey,action:'UPLOAD',title:'Acquisition valuation evidence',pdf:pdf.toString('base64')};
 await request(acquisitionPath,{...acquisitionKey,action:'SAVE',measurement:acquisitionInput.measurement},422);
 const document=await request(documentPath,upload);
 assert.equal(document.sha256,createHash('sha256').update(pdf).digest('hex'));
 assert.deepEqual(await request(documentPath,upload),document);
 await request(documentPath,{...upload,title:'Attempted document replacement'},409);
 const downloaded=await page.request.post(app+documentPath,{data:{...documentKey,action:'DOWNLOAD'},headers:{origin:app}});
 assert.equal(downloaded.status(),200);
 assert.match(downloaded.headers()['content-disposition'],/^attachment;/);
 assert.deepEqual(await downloaded.body(),pdf);
 const measurement={...acquisitionInput.measurement,considerationEvidence:document.id,
  identifiableItems:acquisitionInput.measurement.identifiableItems.map(item=>({...item,measurementEvidence:document.id}))};
 const acquisitionSave={...acquisitionKey,action:'SAVE',measurement};
 await request(acquisitionPath,{...acquisitionSave,measurement:{...measurement,considerationEvidence:randomUUID()}},422);
 const approvedAcquisitionsPath='/api/financial-reporting/group-approved-acquisitions';
 const acquisitionDraft=await request(acquisitionPath,acquisitionSave);
 assert.deepEqual((await request(approvedAcquisitionsPath,query)).rows,[]);
 assert.equal(acquisitionDraft.status,'DRAFT');
 assert.deepEqual(acquisitionDraft.documents,[document]);
 assert.deepEqual(await request(acquisitionPath,acquisitionSave),acquisitionDraft);
 await request(acquisitionPath,{...acquisitionSave,measurement:{...acquisitionSave.measurement,consideration:'1300'}},409);
 const acquisitionApproval=await request(acquisitionPath,{...acquisitionKey,action:'APPROVE',reason:'Reviewer confirmed acquisition evidence in isolated QA'});
 assert.equal(acquisitionApproval.status,'APPROVED');assert.equal(acquisitionApproval.approved_by,actor.id);
 assert.deepEqual(await request(acquisitionPath,{...acquisitionKey,action:'READ'}),acquisitionApproval);
 const approvedAcquisitions=await request(approvedAcquisitionsPath,query);
 assert.equal(approvedAcquisitions.rows.length,1);
 assert.equal(approvedAcquisitions.rows[0].calculation.goodwill,'200.0000');
 assert.equal(approvedAcquisitions.rows[0].calculation.nciAtAcquisition,'0.0000');
 assert.equal(approvedAcquisitions.rows[0].documentCount,1);
 assert.deepEqual((await request(approvedAcquisitionsPath,{...query,to:'2026-11-30'})).rows,[]);
 await writeFile(out+'/approved-acquisition-review.json',JSON.stringify(approvedAcquisitions,null,2));
 const bargainKey={query,id:randomUUID()};
 await request(acquisitionPath,{...bargainKey,action:'SAVE',measurement:{...acquisitionSave.measurement,consideration:'900'}});
 const blockedBargain=await request(acquisitionPath,{...bargainKey,action:'APPROVE',reason:'Unsupported bargain authorization attempt'},422);
 assert.equal(blockedBargain.error,'GROUP_ACQUISITION_REASSESSMENT_REQUIRED');
 const directInput={p_id:randomUUID(),p_root:parent,p_from:query.from,p_to:query.to,p_action:'SAVE',p_measurement:{...acquisitionSave.measurement,approved:true}};
 assert.match((await actor.client.rpc('financial_group_acquisition_evidence_command',directInput)).error?.message??'',/GROUP_ACQUISITION_INPUT_INVALID/);

 const ref=(organizationId,eventId,line,accountId)=>({organizationId,eventId,lineId:line.id,accountId});
 const adjustment={id:randomUUID(),kind:'INTERCOMPANY_BALANCE',date:query.to,amount:'60',reason:'Selected counterpart source legs for review',debitSource:ref(subsidiary,expenseEvent,eline,eline.resolvedPosting.creditAccountId),creditSource:ref(parent,revenue,rline,rline.resolvedPosting.debitAccountId)};
 const unpaired=await request('/api/financial-reporting/group-eliminations',{query,entries:[adjustment]});
 assert.equal(unpaired.documents.status,'DOCUMENT_MATCHING_REQUIRED');
 const proposed=await request('/api/financial-reporting/group-document-matches',{action:'PROPOSE',firstEventId:expenseEvent,secondEventId:revenue,evidenceReference:'Disposable reciprocal source documents reviewed',reason:'Both company documents explicitly paired by owner',requestId:randomUUID()});
 adjustment.documentMatchId=proposed.documentMatchId;
 await request('/api/financial-reporting/group-eliminations',{query,entries:[adjustment]},422);
 await request('/api/financial-reporting/group-document-matches',{action:'APPROVE',matchId:proposed.documentMatchId,reason:'Both companies source references verified'});
 const result=await request('/api/financial-reporting/group-eliminations',{query,entries:[adjustment]});
 assert.equal(result.documents.status,'DOCUMENT_MATCHES_VERIFIED_ONLY');
 assert.equal(result.status,'SOURCE_BOUND_GROUP_PREVIEW_ONLY');assert.equal(result.worksheet.adjustmentDebit,'60.0000');assert.equal(result.worksheet.adjustmentCredit,'60.0000');assert.equal(result.bindings[0].creditSource.eventId,revenue);
 assert.equal(result.openItems.status,'SOURCE_OPEN_ITEMS_VERIFIED_ONLY');assert.deepEqual(result.openItems.bindings.map(b=>b.outstanding).sort(),['100.0000','60.0000']);
 // Persist only group evidence; SQL independently rejects direct RPC bypasses.
 const saveArgs={p_root:parent,p_from:query.from,p_to:query.to,p_expected_version:0,p_entries:[{...adjustment,amount:'61'}],p_reason:'Direct RPC cannot exceed source balance',p_request_id:randomUUID()};
 const directExcess=await actor.client.rpc('save_financial_group_eliminations',saveArgs);
 assert.match(directExcess.error?.message??'',/GROUP_BATCH_SOURCE_AMOUNT_EXCEEDED/);
 const noDate=structuredClone(adjustment);delete noDate.date;
 const malformed=await actor.client.rpc('save_financial_group_eliminations',{...saveArgs,p_entries:[noDate],p_request_id:randomUUID()});assert.match(malformed.error?.message??'',/GROUP_BATCH_INPUT_INVALID/);
 const save={action:'SAVE',query,entries:[adjustment],expectedVersion:0,reason:'Reviewed group-only adjustment batch',requestId:randomUUID()};
 const batch=await request('/api/financial-reporting/group-elimination-batches',save);
 assert.equal(batch.status,'DRAFT');assert.equal(batch.version,1);
 assert.deepEqual(await request('/api/financial-reporting/group-elimination-batches',save),batch);
 const batch2=await request('/api/financial-reporting/group-elimination-batches',{...save,expectedVersion:1,requestId:randomUUID()});
 await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query,batchId:batch.id,expectedVersion:1,reason:'Stale version is not approvable'},409);
 const approved=await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query,batchId:batch2.id,expectedVersion:2,reason:'Current batch verified against both original companies'});
 assert.equal(approved.status,'APPROVED');
 const context=await rpc('financial_group_elimination_context',{p_root:parent,p_from:query.from,p_to:query.to});
 assert.equal(context.batches.filter(b=>b.status==='APPROVED').length,1);
 assert.equal(context.batches.find(b=>b.id===batch2.id).approved_by,actor.id);
 const batch3=await request('/api/financial-reporting/group-elimination-batches',{...save,expectedVersion:2,requestId:randomUUID()});
 await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query,batchId:batch3.id,expectedVersion:3,reason:'Replacement batch keeps prior audit history'});
 const replaced=await rpc('financial_group_elimination_context',{p_root:parent,p_from:query.from,p_to:query.to});
 assert.equal(replaced.batches.find(b=>b.id===batch2.id).status,'SUPERSEDED');
 assert.equal(replaced.batches.filter(b=>b.status==='APPROVED').length,1);
 const currentBatch=await actor.client.rpc('financial_group_approved_eliminations',{p_root:parent,p_from:query.from,p_to:query.to});
 assert.ifError(currentBatch.error);assert.equal(currentBatch.data.id,batch3.id);assert.equal(currentBatch.data.version,3);
 assert.equal(currentBatch.data.status,'APPROVED_GROUP_ELIMINATION_EVIDENCE');
 const approvedWorksheet=await request('/api/financial-reporting/group-approved-eliminations',query);
 assert.equal(approvedWorksheet.status,'APPROVED_GROUP_ADJUSTMENT_WORKSHEET');assert.equal(approvedWorksheet.approval.id,batch3.id);
 assert.equal(approvedWorksheet.consolidated,false);assert.equal(approvedWorksheet.worksheet.adjustmentDebit,'60.0000');
 await page.goto(app+'/en/financial-reports?organization='+parent+'&screen=position');
 await page.locator('#corp-organization-controls').getByRole('button',{name:'Company and subsidiaries',exact:true}).click();
 const worksheet=page.locator('[data-approved-group-adjustments="true"]');
 // Approval belongs to the exact selected period, not the default year-to-date.
 await worksheet.getByText('No approved adjustment batch exists for the selected period.',{exact:true}).waitFor();
 await page.getByLabel('To date',{exact:true}).fill(query.to);
 const acquisitionSection=worksheet.locator('[data-approved-acquisition-review]');
 await acquisitionSection.getByText('Goodwill',{exact:true}).waitFor();
 assert.match(await acquisitionSection.locator('tbody').innerText(),/200[.]00/);
 const basisRequest={...acquisitionKey,action:'LEDGER_BASIS'};
 const basis=await request(approvedAcquisitionsPath,basisRequest);
 assert.equal(basis.date,'2026-01-01');
 assert.equal(basis.parentInvestmentAccountGroupBalance,'0.0000');
 assert.equal(basis.subsidiaryBookEquity,'5000.0000');
 assert.equal(basis.fairValueLessBookEquity,'-4000.0000');
 await acquisitionSection.getByRole('button',{name:'Acquisition-date book balances',exact:true}).click();
 const basisPanel=acquisitionSection.locator('[data-acquisition-ledger-basis]');
 await basisPanel.getByText('Subsidiary book equity',{exact:true}).waitFor();
 assert.match(await basisPanel.innerText(),/5,000[.]00/);
 await writeFile(out+'/acquisition-ledger-basis.json',JSON.stringify(basis,null,2));
 await worksheet.locator('[data-group-statement-worksheet] table').first().waitFor();
 assert.ok((await worksheet.textContent()).includes('Approved version: 3'));
 await worksheet.locator('[data-group-statement-worksheet]').waitFor();
 assert.equal(await worksheet.locator('[data-group-statement-worksheet] table').count(),3);
 const reviewDownloadPromise=page.waitForEvent('download');
 await worksheet.getByRole('button',{name:'Export review worksheet CSV',exact:true}).click();
 const reviewDownload=await reviewDownloadPromise;
 await reviewDownload.saveAs(out+'/approved-group-review.csv');
 const reviewCsv=await readFile(out+'/approved-group-review.csv','utf8');
 assert.ok(reviewCsv.includes('NOT final consolidated statements'));
 assert.ok(reviewCsv.includes(parent)&&reviewCsv.includes(query.from)&&reviewCsv.includes(query.to));
 assert.ok(reviewCsv.includes('"Approved version","3"'));
 assert.ok(reviewCsv.includes('"Financial position"')||reviewCsv.includes('"position"'));
 assert.ok(reviewCsv.includes('حقوق الملكية'));
 assert.ok(reviewCsv.includes('Goodwill / الشهرة'));
 assert.ok(reviewCsv.includes('"1200.0000","1000.0000","200.0000","0.0000"'));
 assert.ok(reviewCsv.includes(acquisitionKey.id));

 await page.screenshot({path:out+'/approved-group-adjustments-en.png',fullPage:true});


 const excessive=await request('/api/financial-reporting/group-eliminations',{query,entries:[{...adjustment,amount:'61'}]},422);assert.equal(excessive.error,'GROUP_ADJUSTMENT_EXCEEDS_DETAIL_SOURCE');
 // Preview must not write or alter either company's journal or opening sources.
 const clean=p=>{const copy=structuredClone(p);delete copy.coverage.readAt;return copy};assert.deepEqual(clean(await raw(parent)),clean(p));assert.deepEqual(clean(await raw(subsidiary)),clean(s));
 sql(`update public.organization_members set status='INACTIVE' where organization_id='${subsidiary}' and user_id='${actor.id}'`);
 try{
  await request('/api/financial-reporting/group-eliminations',{query,entries:[adjustment]},403);
  await request('/api/financial-reporting/group-acquisition-review',acquisitionInput,403);
  await request(acquisitionPath,{...acquisitionKey,action:'READ'},403);
  await request(approvedAcquisitionsPath,query,403);
  await request(approvedAcquisitionsPath,basisRequest,403);
  await request(documentPath,{...documentKey,action:'DOWNLOAD'},403);
 }finally{sql(`update public.organization_members set status='ACTIVE' where organization_id='${subsidiary}' and user_id='${actor.id}'`)}
 const acquisitionRevoked=await request(acquisitionPath,{...acquisitionKey,action:'REVOKE',reason:'Reviewer withdrew the isolated acquisition evidence'});
 assert.equal(acquisitionRevoked.status,'REVOKED');
 assert.equal(acquisitionRevoked.revoked_by,actor.id);
 assert.equal(acquisitionRevoked.approved_by,actor.id);
 const revokedBasis=await request(approvedAcquisitionsPath,basisRequest,422);
 assert.equal(revokedBasis.error,'GROUP_ACQUISITION_APPROVAL_REQUIRED');
 const revokedAcquisitionDownload=page.waitForEvent('download');
 await worksheet.getByRole('button',{name:'Export review worksheet CSV',exact:true}).click();
 const afterRevocation=await revokedAcquisitionDownload;
 await afterRevocation.saveAs(out+'/approved-group-review-after-acquisition-revocation.csv');
 const afterRevocationCsv=await readFile(out+'/approved-group-review-after-acquisition-revocation.csv','utf8');
 assert.ok(afterRevocationCsv.includes('No approved acquisition records for this period'));
 assert.ok(!afterRevocationCsv.includes(acquisitionKey.id));
 await worksheet.locator('[data-approved-acquisition-review]').getByText('No approved acquisition records for this period.',{exact:true}).waitFor();
 assert.deepEqual((await request(approvedAcquisitionsPath,query)).rows,[]);
 await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
 await acquisitionSection.getByText('No approved acquisition records for this period.',{exact:true}).waitFor();
 assert.equal(await acquisitionSection.locator('table').count(),0);
 await worksheet.getByRole('button',{name:'Export review worksheet CSV',exact:true}).waitFor();
 await request(acquisitionPath,{...acquisitionKey,action:'APPROVE',reason:'Revoked records must never be reapproved'},409);
 await writeFile(out+'/acquisition-evidence-lifecycle.json',JSON.stringify({draft:acquisitionDraft,approval:acquisitionApproval,revocation:acquisitionRevoked},null,2));
 await request('/api/financial-reporting/group-document-matches',{action:'REVOKE',matchId:proposed.documentMatchId,reason:'Isolated acceptance proves revoked evidence is excluded'});
 await request('/api/financial-reporting/group-eliminations',{query,entries:[adjustment]},422);
 const revokedSave=await actor.client.rpc('save_financial_group_eliminations',{...saveArgs,p_expected_version:3,p_entries:[adjustment],p_request_id:randomUUID()});
 assert.match(revokedSave.error?.message??'',/GROUP_BATCH_DOCUMENT_NOT_APPROVED/);
 const revokedRead=await actor.client.rpc('financial_group_approved_eliminations',{p_root:parent,p_from:query.from,p_to:query.to});
 assert.match(revokedRead.error?.message??'',/GROUP_BATCH_DOCUMENT_NOT_APPROVED/);
 await request('/api/financial-reporting/group-approved-eliminations',query,422);
 let revokedDownload=false;const onRevokedDownload=()=>{revokedDownload=true};page.on('download',onRevokedDownload);
 await worksheet.getByRole('button',{name:'Export review worksheet CSV',exact:true}).click();
 await worksheet.getByText('Approved adjustments could not be verified against current sources. No amounts are shown.',{exact:true}).waitFor();assert.equal(await worksheet.locator('table').count(),0);
 assert.equal(revokedDownload,false);page.off('download',onRevokedDownload);
 await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
 await worksheet.getByText('Approved adjustments could not be verified against current sources. No amounts are shown.',{exact:true}).waitFor();assert.equal(await worksheet.locator('table').count(),0);


 // A real reciprocal receipt/payment is approved separately from invoice balances.
 const cashEvents=[];
 for(const [organization,direction,type]of [[parent,'INFLOW','REVENUE'],[subsidiary,'OUTFLOW','OPEX']]){
  const banks=await actor.client.from('liquidity_accounts').select('id').eq('organization_id',organization).eq('active',true).limit(1);assert.ifError(banks.error);assert.ok(banks.data.length);
  const party=await request('/api/liquidity',{kind:'counterparty',organization_id:organization,name:'Group cash counterpart',party_type:direction==='INFLOW'?'CUSTOMER':'SUPPLIER'},201);
  const category=await request('/api/liquidity',{kind:'category',organization_id:organization,name_ar:'تدفق داخلي للاختبار',name_en:'Group internal cash test',flow_group:'OPERATING',accounting_group:type==='OPEX'?'EXPENSE':'REVENUE',treatment_code:type==='OPEX'?'OPERATING_EXPENSE':'SERVICE_REVENUE',allowed_direction:direction,financial_classification_type:type},201);
  const flow=await request('/api/liquidity',{kind:'flow',organization_id:organization,account_id:banks.data[0].id,category_id:category.id,direction,title:'Documented group internal cash',counterparty_id:party.id,due_date:'2026-10-10',amount:10,base_amount:10,currency:'SAR',status:'EXPECTED',source:'MANUAL'},201);
  const patch=async data=>{const response=await page.request.patch(app+'/api/liquidity/'+flow.id,{data,headers:{origin:app}});const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));return body};
  const confirmed=await patch({status:'CONFIRMED'});assert.ok(confirmed.recognition_event_id);
  await command({action:'APPROVE',organization_id:organization,event_id:confirmed.recognition_event_id,note:'Approve documented group cash source'});
  await command({action:'TRANSITION',organization_id:organization,event_id:confirmed.recognition_event_id,status:'ACTUAL',note:'Post documented group cash source'});
  const posted=await patch({status:'ACTUAL',request_id:randomUUID(),account_id:banks.data[0].id,amount:10,base_amount:10,settlement_date:'2026-10-11'});assert.ok(posted.settlement_event_id);
  const source=await raw(organization),event=source.events.find(e=>e.id===posted.settlement_event_id);assert.ok(event);
  const line=event.lines[0];cashEvents.push(ref(organization,event.id,line,line.resolvedPosting[direction==='INFLOW'?'debitAccountId':'creditAccountId']));
 }
 const cashDoc=await request('/api/financial-reporting/group-document-matches',{action:'PROPOSE',firstEventId:cashEvents[0].eventId,secondEventId:cashEvents[1].eventId,evidenceReference:'Reciprocal bank payment and receipt evidence',reason:'Actual cash source documents reviewed',requestId:randomUUID()});
 await request('/api/financial-reporting/group-document-matches',{action:'APPROVE',matchId:cashDoc.documentMatchId,reason:'Confirm both original bank documents'});
 const cashEntry={id:randomUUID(),kind:'INTERCOMPANY_CASH',documentMatchId:cashDoc.documentMatchId,date:query.to,amount:'10',reason:'Exclude paired internal operating cash flows',debitSource:cashEvents[1],creditSource:cashEvents[0]};
 const cashBefore=[await raw(parent),await raw(subsidiary)];
 const cashBad=await actor.client.rpc('save_financial_group_eliminations',{...saveArgs,p_expected_version:3,p_entries:[{...cashEntry,amount:'11'}],p_request_id:randomUUID()});assert.match(cashBad.error?.message??'',/GROUP_BATCH_SOURCE_AMOUNT_EXCEEDED/);
 const cashBatch=await request('/api/financial-reporting/group-elimination-batches',{...save,entries:[cashEntry],expectedVersion:3,requestId:randomUUID()});
 await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query,batchId:cashBatch.id,expectedVersion:4,reason:'Approve actual internal cash exclusions'});
 const cashResult=await request('/api/financial-reporting/group-approved-eliminations',query);
 assert.equal(cashResult.cashWorksheet.bindings.length,1);assert.equal(cashResult.cashWorksheet.bindings[0].outflow.eliminatedAmount,'10.0000');
 assert.equal(cashResult.cashWorksheet.rows.find(r=>r.activity==='OPERATING').adjustment,'0.0000');
 assert.deepEqual([await raw(parent),await raw(subsidiary)].map(clean),cashBefore.map(clean));
 await writeFile(out+'/approved-internal-cash-eliminations.json',JSON.stringify(cashResult,null,2));
 await request('/api/financial-reporting/group-document-matches',{action:'REVOKE',matchId:cashDoc.documentMatchId,reason:'Verify cash approval invalidation on documentary revocation'});
 await request('/api/financial-reporting/group-approved-eliminations',query,422);

 const {verifyGroupCapitalContribution}=await import('./verify-group-capital-contribution.mjs');
 const investmentAccount=await verifyGroupCapitalContribution({actor,request,rpc,command,raw,sql,parent,subsidiary,query,out});
 const investmentEvent=await command({action:'CREATE',payload:{
  organization_id:parent,entity_id:null,counterparty_id:null,event_type:'ADJUSTMENT',source_module:'OPERATIONAL_CONSOLE',
  source_record_id:null,source_event_key:'actual-acquisition:'+randomUUID(),event_date:query.from,due_date:null,
  base_currency:'SAR',description:'Original acquisition-day investment',
  lines:[{line_number:1,cost_center_id:null,description:'Invest in the approved subsidiary',
   classification_id:investmentAccount.classification,amount:5200,base_amount:5200,currency:'SAR',exchange_rate:1,
   cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[],links:[],
 }});
 for(const status of ['PLANNED','COMMITTED'])await command({action:'TRANSITION',organization_id:parent,event_id:investmentEvent,status,note:'Actual acquisition acceptance'});
 await command({action:'APPROVE',organization_id:parent,event_id:investmentEvent,note:'Approve acquisition investment source'});
 await command({action:'TRANSITION',organization_id:parent,event_id:investmentEvent,status:'ACTUAL',note:'Post acquisition investment source'});
 const posted=(await raw(parent)).events.find(event=>event.id===investmentEvent);
 assert.ok(posted);
 const investmentLink={accountId:investmentAccount.accountId,eventId:investmentEvent,lineId:posted.lines[0].id,documentId:document.id};
 const linkedKey={query,id:randomUUID()};
 const linkSave={...linkedKey,action:'SAVE',measurement:{...measurement,consideration:'5200',investmentLink}};
 await request(acquisitionPath,{...linkSave,measurement:{...linkSave.measurement,investmentLink:{...investmentLink,accountId:'110001'}}},400);
 const badLink=await actor.client.rpc('financial_group_acquisition_evidence_command',{
  p_action:'SAVE',p_id:randomUUID(),p_root:parent,p_from:query.from,p_to:query.to,
  p_measurement:{...linkSave.measurement,investmentLink:{...investmentLink,eventId:revenue}},
 });
 assert.match(badLink.error?.message??'',/GROUP_ACQUISITION_INVESTMENT_UNRECONCILED/);
 const linkedDraft=await request(acquisitionPath,linkSave);assert.equal(linkedDraft.status,'DRAFT');
 const linkedApproval=await request(acquisitionPath,{...linkedKey,action:'APPROVE',reason:'Confirmed exact original investment, subsidiary and evidence'});
 assert.equal(linkedApproval.status,'APPROVED');
 const linkedBasis=await request(approvedAcquisitionsPath,{...linkedKey,action:'LEDGER_BASIS'});
 assert.deepEqual(linkedBasis.linkedInvestment,{accountId:investmentAccount.accountId,balance:'5200.0000'});
 assert.equal(linkedBasis.parentInvestmentAccountGroupBalance,'5200.0000');
 await writeFile(out+'/verified-acquisition-investment-link.json',JSON.stringify({linkedBasis,investmentLink},null,2));
 const positionAction={action:'ACQUISITION_POSITION',query};
 assert.equal((await request(approvedAcquisitionsPath,positionAction)).status,'ACQUISITION_POSITION_UNAVAILABLE');
 await request(acquisitionPath,{...linkedKey,action:'REVOKE',reason:'Switch to isolated acquisition-day position fixture'});
 const dayQuery={...query,to:query.from};
 const dayKey={query:dayQuery,id:randomUUID()};
 const standalone=await rpc('financial_statement_live_snapshot',{p_org:subsidiary,p_from:dayQuery.from,p_to:dayQuery.to});
 const openingCash=standalone.opening.find(row=>Number(row.debit)===5000);
 assert.ok(openingCash);
 const dayMeasurement={...linkSave.measurement,identifiableItems:[
  {id:openingCash.accountId,kind:'ASSET',recognizedAmount:'5000',measurementEvidence:document.id},
 ]};
 await request(acquisitionPath,{...dayKey,action:'SAVE',measurement:dayMeasurement});
 await request(acquisitionPath,{...dayKey,action:'APPROVE',reason:'Confirm acquired cash carrying value and original investment'});
 const dayBatch=await request('/api/financial-reporting/group-elimination-batches',{
  ...save,query:dayQuery,entries:[],expectedVersion:0,requestId:randomUUID(),reason:'Verify acquisition day has no overlapping eliminations',
 });
 await request('/api/financial-reporting/group-elimination-batches',{
  action:'APPROVE',query:dayQuery,batchId:dayBatch.id,expectedVersion:1,reason:'Approve separate acquisition-day worksheet',
 });
 const dayPositionAction={action:'ACQUISITION_POSITION',query:dayQuery};
 const acquisitionPosition=await request(approvedAcquisitionsPath,dayPositionAction);
 assert.equal(acquisitionPosition.status,'ACQUISITION_DAY_POSITION_REVIEW');
 assert.equal(acquisitionPosition.investmentEliminated,'5200.0000');
 assert.equal(acquisitionPosition.subsidiaryEquityEliminated,'5000.0000');
 assert.equal(acquisitionPosition.goodwill,'200.0000');
 assert.deepEqual(acquisitionPosition.rows.map(row=>[row.key,row.adjustment,row.after]),[
  ['assets','-5000.0000','5700.0000'],['liabilities','0.0000','5200.0000'],['equity','-5000.0000','500.0000'],
 ]);
 await page.getByLabel('To date',{exact:true}).fill(dayQuery.to);
 await worksheet.getByRole('button',{name:'Review acquisition-day position',exact:true}).click();
 const positionPanel=worksheet.locator('[data-acquisition-position-review]');
 await positionPanel.getByText('Position after acquisition adjustment',{exact:true}).waitFor();
 assert.ok((await positionPanel.innerText()).includes('5,700.00'));
 await writeFile(out+'/acquisition-day-position.json',JSON.stringify(acquisitionPosition,null,2));
 await request(acquisitionPath,{...dayKey,action:'REVOKE',reason:'Verify approved acquisition position disappears on next read'});
 assert.equal((await request(approvedAcquisitionsPath,dayPositionAction)).status,'ACQUISITION_POSITION_UNAVAILABLE');
 const openingAccountIds=new Set(standalone.opening.filter(row=>Number(row.debit)!==Number(row.credit)).map(row=>row.accountId));
 const newLiability=standalone.accounts.find(account=>account.kind==='LIABILITY'&&!openingAccountIds.has(account.id));
 assert.ok(newLiability,'A verified liability account is required for fair-value acceptance');
 const fairKey={query:dayQuery,id:randomUUID()};
 const fairMeasurement={...dayMeasurement,identifiableItems:[...dayMeasurement.identifiableItems,{
  id:newLiability.id,kind:'LIABILITY',recognizedAmount:'100',measurementEvidence:document.id,
 }]};
 const fairSave={...fairKey,action:'SAVE',measurement:fairMeasurement};
 await request(acquisitionPath,{...fairSave,measurement:{...fairMeasurement,fairValueBasis:{
  deferredTax:'NOT_REQUIRED',taxEvidenceDocumentId:randomUUID(),
 }}},422);
 await request(acquisitionPath,fairSave);
 await request(acquisitionPath,{...fairKey,action:'APPROVE',reason:'Approve liability valuation for tax-basis exclusion verification'});
 assert.equal((await request(approvedAcquisitionsPath,dayPositionAction)).reason,'FAIR_VALUE_TAX_BASIS_REQUIRED');
 await request(acquisitionPath,{...fairKey,action:'REVOKE',reason:'Replace valuation with its reviewed tax evidence'});
 const documentedKey={query:dayQuery,id:randomUUID()};
 await request(acquisitionPath,{...documentedKey,action:'SAVE',measurement:{...fairMeasurement,fairValueBasis:{
  deferredTax:'NOT_REQUIRED',taxEvidenceDocumentId:document.id,
 }}});
 await request(acquisitionPath,{...documentedKey,action:'APPROVE',reason:'Approve independently documented valuation and deferred tax assessment'});
 const fairPosition=await request(approvedAcquisitionsPath,dayPositionAction);
 assert.equal(fairPosition.goodwill,'300.0000');
 assert.deepEqual(fairPosition.fairValueAdjustments.map(row=>[row.accountId,row.kind,row.adjustment]),[[newLiability.id,'LIABILITY','100.0000']]);
 assert.deepEqual(fairPosition.rows.map(row=>[row.key,row.after]),[
  ['assets','5800.0000'],['liabilities','5300.0000'],['equity','500.0000'],
 ]);
 await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
 await worksheet.getByRole('button',{name:'Review acquisition-day position',exact:true}).click();
 await positionPanel.getByText('Acquisition-date fair value adjustments',{exact:true}).waitFor();
 await writeFile(out+'/acquisition-day-fair-value-position.json',JSON.stringify(fairPosition,null,2));
 await request(acquisitionPath,{...documentedKey,action:'REVOKE',reason:'Close acquisition-day fixture before testing period continuation'});
 const periodQuery={...query,to:'2026-01-31'};
 const periodAction={action:'ACQUISITION_POSITION',query:periodQuery};
 const periodKey={query:periodQuery,id:randomUUID()};
 const periodMeasurement={...fairMeasurement,fairValueBasis:{deferredTax:'NOT_REQUIRED',taxEvidenceDocumentId:document.id}};
 await request(acquisitionPath,{...periodKey,action:'SAVE',measurement:periodMeasurement});
 await request(acquisitionPath,{...periodKey,action:'APPROVE',reason:'Approve period fixture without continuity evidence'});
 assert.equal((await request(approvedAcquisitionsPath,periodAction)).reason,'CONTINUITY_EVIDENCE_OR_OWNERSHIP_REQUIRED');
 await request(acquisitionPath,{...periodKey,action:'REVOKE',reason:'Replace with a documented continuation assessment'});
 const carryKey={query:periodQuery,id:randomUUID()};
 const carryMeasurement={...periodMeasurement,continuityBasis:{treatment:'NO_SUBSEQUENT_ADJUSTMENTS',evidenceDocumentId:document.id}};
 await request(acquisitionPath,{...carryKey,action:'SAVE',measurement:carryMeasurement});
 await request(acquisitionPath,{...carryKey,action:'APPROVE',reason:'Approve documented unchanged balances and no subsequent adjustments'});
 const periodBatch=await request('/api/financial-reporting/group-elimination-batches',{
  ...save,query:periodQuery,entries:[],expectedVersion:0,requestId:randomUUID(),reason:'Verify continuation scope without overlapping eliminations',
 });
 await request('/api/financial-reporting/group-elimination-batches',{
  action:'APPROVE',query:periodQuery,batchId:periodBatch.id,expectedVersion:1,reason:'Approve the January closing worksheet',
 });
 const carried=await request(approvedAcquisitionsPath,periodAction);
 assert.equal(carried.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW');
 assert.equal(carried.goodwill,'300.0000');
 assert.deepEqual(carried.rows.map(row=>[row.key,row.after]),[
  ['assets','5800.0000'],['liabilities','5300.0000'],['equity','500.0000'],
 ]);
 await page.getByLabel('To date',{exact:true}).fill(periodQuery.to);
 await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
 await positionPanel.getByText('Closing position after carrying forward the acquisition adjustment',{exact:true}).waitFor();
 await writeFile(out+'/acquisition-carry-forward-position.json',JSON.stringify(carried,null,2));
 await request(acquisitionPath,{...carryKey,action:'REVOKE',reason:'Verify withdrawn continuity assessment blocks period closing review'});
 assert.equal((await request(approvedAcquisitionsPath,periodAction)).status,'ACQUISITION_POSITION_UNAVAILABLE');
 const upliftAccount=standalone.accounts.find(account=>account.kind==='ASSET'&&
  (account.reportingCode??account.id)==='1500'&&!openingAccountIds.has(account.id));
 assert.ok(upliftAccount,'A verified fixed asset account is required for acquisition depreciation acceptance');
 const upliftMeasurement={...carryMeasurement,identifiableItems:[...carryMeasurement.identifiableItems,{
  id:upliftAccount.id,kind:'ASSET',recognizedAmount:'200',measurementEvidence:document.id,
 }]};
 const unsupportedUpliftKey={query:periodQuery,id:randomUUID()};
 await request(acquisitionPath,{...unsupportedUpliftKey,action:'SAVE',measurement:upliftMeasurement});
 await request(acquisitionPath,{...unsupportedUpliftKey,action:'APPROVE',reason:'Exercise the requirement for a verified depreciation schedule'});
 assert.equal((await request(approvedAcquisitionsPath,periodAction)).reason,'SUBSEQUENT_ASSET_MEASUREMENT_REQUIRED');
 await request(acquisitionPath,{...unsupportedUpliftKey,action:'REVOKE',reason:'Replace the assessment with a documented straight-line schedule'});
 const scheduledKey={query:periodQuery,id:randomUUID()};
 const scheduledMeasurement={...upliftMeasurement,continuityBasis:{
  treatment:'STRAIGHT_LINE_UPLIFT',evidenceDocumentId:document.id,schedules:[{accountId:upliftAccount.id,usefulLifeDays:60}],
 }};
 await request(acquisitionPath,{...scheduledKey,action:'SAVE',measurement:scheduledMeasurement});
 await request(acquisitionPath,{...scheduledKey,action:'APPROVE',reason:'Approve incremental straight-line depreciation supported by the acquisition report'});
 const depreciated=await request(approvedAcquisitionsPath,periodAction);
 assert.equal(depreciated.goodwill,'100.0000');
 assert.deepEqual(depreciated.depreciationAdjustments.map(row=>[row.accountId,row.charge,row.remainingUplift]),[
  [upliftAccount.id,'100.0000','100.0000'],
 ]);
 assert.deepEqual(depreciated.rows.map(row=>[row.key,row.after]),[
  ['assets','5700.0000'],['liabilities','5300.0000'],['equity','400.0000'],
 ]);
 assert.equal(depreciated.income.find(row=>row.key==='netProfit').after,'-100.0000');
 await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
 await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
 await positionPanel.getByText('Depreciation of acquisition uplift',{exact:true}).waitFor();
 await writeFile(out+'/acquisition-depreciation-position.json',JSON.stringify(depreciated,null,2));
 await request(acquisitionPath,{...scheduledKey,action:'REVOKE',reason:'Release the isolated approval for movement detection acceptance'});
 const taxKey={query:periodQuery,id:randomUUID()};
 const taxMeasurement={...scheduledMeasurement,
  fairValueBasis:{deferredTax:'INCLUDED_IN_IDENTIFIABLE_ITEMS',taxEvidenceDocumentId:document.id},
  identifiableItems:scheduledMeasurement.identifiableItems.map(item=>item.id===newLiability.id?
   {...item,recognizedAmount:'40'}:item),
  continuityBasis:{...scheduledMeasurement.continuityBasis,schedules:[
   {accountId:upliftAccount.id,usefulLifeDays:60,deferredTaxLiabilityAccountId:newLiability.id},
  ]},
 };
 await request(acquisitionPath,{...taxKey,action:'SAVE',measurement:taxMeasurement});
 await request(acquisitionPath,{...taxKey,action:'APPROVE',reason:'Approve documented opening tax liability and unchanged reversal basis'});
 const afterTax=await request(approvedAcquisitionsPath,periodAction);
 assert.equal(afterTax.goodwill,'40.0000');
 assert.deepEqual(afterTax.deferredTaxAdjustments.map(row=>[row.accountId,row.openingLiability,row.reversal,row.remainingLiability]),[
  [newLiability.id,'40.0000','20.0000','20.0000'],
 ]);
 assert.deepEqual(afterTax.rows.map(row=>[row.key,row.after]),[
  ['assets','5640.0000'],['liabilities','5220.0000'],['equity','420.0000'],
 ]);
 assert.equal(afterTax.income.find(row=>row.key==='tax').adjustment,'-20.0000');
 assert.equal(afterTax.income.find(row=>row.key==='netProfit').after,'-80.0000');
 await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
 await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
 await positionPanel.getByText('Acquisition deferred tax reversal',{exact:true}).waitFor();
 await writeFile(out+'/acquisition-deferred-tax-position.json',JSON.stringify(afterTax,null,2));
 await request(acquisitionPath,{...taxKey,action:'REVOKE',reason:'Release the tax fixture for subsequent movement verification'});

 // Both accrual and bank vouchers predate the later capital contribution.
 const jointQuery={...query,to:'2026-10-12'};
 const jointKey={query:jointQuery,id:randomUUID()};
 const jointAction={action:'ACQUISITION_POSITION',query:jointQuery};
 const jointDocument=async(firstEventId,secondEventId)=>{
  const match=await request('/api/financial-reporting/group-document-matches',{action:'PROPOSE',firstEventId,secondEventId,
   evidenceReference:'Original reciprocal documents for the post-acquisition period',
   reason:'Review the joint acquisition and operations worksheet',requestId:randomUUID()});
  await request('/api/financial-reporting/group-document-matches',{action:'APPROVE',matchId:match.documentMatchId,
   reason:'Verify the original source pair for the joint worksheet'});
  return match.documentMatchId;
 };
 const accrualMatch=await jointDocument(expenseEvent,revenue);
 const settlementMatch=await jointDocument(cashEvents[0].eventId,cashEvents[1].eventId);
 const jointEntries=[
  {...adjustment,documentMatchId:accrualMatch,date:jointQuery.to},
  {id:randomUUID(),kind:'INTERCOMPANY_INCOME',documentMatchId:accrualMatch,date:jointQuery.to,amount:'60',
   reason:'Eliminate reciprocal revenue and operating expenses after acquisition',
   debitSource:ref(parent,revenue,rline,rline.resolvedPosting.creditAccountId),
   creditSource:ref(subsidiary,expenseEvent,eline,eline.resolvedPosting.debitAccountId)},
  {...cashEntry,documentMatchId:settlementMatch,date:jointQuery.to},
 ];
 await request(acquisitionPath,{...jointKey,action:'SAVE',measurement:{...dayMeasurement,
  continuityBasis:carryMeasurement.continuityBasis}});
 await request(acquisitionPath,{...jointKey,action:'APPROVE',reason:'Approve unchanged acquisition basis for the joint worksheet'});
 const jointBatch=await request('/api/financial-reporting/group-elimination-batches',{
  ...save,query:jointQuery,entries:jointEntries,expectedVersion:0,requestId:randomUUID(),
  reason:'Combine approved trade balances, income and internal cash with acquisition',
 });
 await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query:jointQuery,batchId:jointBatch.id,
  expectedVersion:1,reason:'Approve the reciprocal operating adjustments in this period'});
 const ledgerBeforeJoint=[await raw(parent),await raw(subsidiary)].map(clean);
 const joint=await request(approvedAcquisitionsPath,jointAction);
 assert.equal(joint.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(joint));
 assert.equal(joint.eliminationBatchVersion,1);
 assert.equal(joint.investmentEliminated,'5200.0000');
 assert.equal(joint.goodwill,'200.0000');
 assert.deepEqual(joint.rows.map(row=>[row.key,row.adjustment]),[
  ['assets','-5060.0000'],['liabilities','-60.0000'],['equity','-5000.0000'],
 ]);
 assert.equal(joint.income.find(row=>row.key==='revenue').adjustment,'-60.0000');
 assert.equal(joint.income.find(row=>row.key==='operatingExpenses').adjustment,'-60.0000');
 assert.equal(joint.income.find(row=>row.key==='netProfit').adjustment,'0.0000');
 assert.equal(joint.cash.length,6);
 assert.equal(joint.cash.find(row=>row.key==='closing').adjustment,'0.0000');
 assert.deepEqual([await raw(parent),await raw(subsidiary)].map(clean),ledgerBeforeJoint);
 await page.getByLabel('To date',{exact:true}).fill(jointQuery.to);
 await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
 for(const heading of ['Financial position after acquisition and intercompany eliminations',
  'Income after acquisition and intercompany eliminations','Cash flow after intercompany eliminations'])
  await positionPanel.getByRole('heading',{name:heading,exact:true}).waitFor();
 await writeFile(out+'/acquisition-and-intercompany-eliminations.json',JSON.stringify(joint,null,2));
 await request('/api/financial-reporting/group-document-matches',{action:'REVOKE',matchId:accrualMatch,
  reason:'Verify a withdrawn source prevents the combined report from reloading'});
 await request(approvedAcquisitionsPath,jointAction,503);
 await request(acquisitionPath,{...jointKey,action:'REVOKE',reason:'Complete the joint worksheet acceptance scenario'});
 console.log('PASS Acquisition and approved trade, income and cash eliminations reconcile together');

 const movedKey={query,id:randomUUID()};
 await request(acquisitionPath,{...movedKey,action:'SAVE',measurement:carryMeasurement});
 await request(acquisitionPath,{...movedKey,action:'APPROVE',reason:'Confirm the control detects later postings to the investment account'});
 const movedBatch=await request('/api/financial-reporting/group-elimination-batches',{
  ...save,entries:[],expectedVersion:5,requestId:randomUUID(),reason:'Approve year-long source for movement detection',
 });
 await request('/api/financial-reporting/group-elimination-batches',{
  action:'APPROVE',query,batchId:movedBatch.id,expectedVersion:6,reason:'Check movement against approved year-long report',
 });
 assert.equal((await request(approvedAcquisitionsPath,positionAction)).reason,'SUBSEQUENT_ACCOUNT_MOVEMENT');
 await request(acquisitionPath,{...movedKey,action:'REVOKE',reason:'Complete the independent majority ownership fixture'});
 // This isolated fixture reuses the same posted sources under a documented
 // 80% relationship. It does not represent an ownership change in the period.
 sql(`update private.financial_group_control_assessments set economic_interest_percent=80,
  voting_interest_percent=80 where id='${control}'`);
 try{
  const minorityDocumentKey={...documentKey,id:randomUUID()};
  const minorityDocument=await request(documentPath,{...minorityDocumentKey,action:'UPLOAD',
   title:'Evidence of 80 percent control and subsequent measurement',pdf:pdf.toString('base64')});
  const minorityJointKey={query:jointQuery,id:randomUUID()};
  const minorityJointMatch=await jointDocument(expenseEvent,revenue);
  const minorityJointRequest={...save,query:jointQuery,expectedVersion:1,
   entries:[{...jointEntries[0],documentMatchId:minorityJointMatch},jointEntries[2]],requestId:randomUUID(),
   reason:'Review reciprocal balances and cash under documented majority ownership'};
  const noJointAcquisition=await request('/api/financial-reporting/group-elimination-batches',minorityJointRequest,422);
  assert.equal(noJointAcquisition.error,'GROUP_BATCH_NCI_REQUIRED');
  await request(acquisitionPath,{...minorityJointKey,action:'SAVE',measurement:{...dayMeasurement,
   considerationEvidence:minorityDocument.id,investmentLink:{...investmentLink,documentId:minorityDocument.id},
   identifiableItems:dayMeasurement.identifiableItems.map(item=>({...item,measurementEvidence:minorityDocument.id})),
   continuityBasis:{...carryMeasurement.continuityBasis,evidenceDocumentId:minorityDocument.id},
  }});
  await request(acquisitionPath,{...minorityJointKey,action:'APPROVE',reason:'Approve the exact group and period at eighty percent ownership'});
  const incomeRejected=await actor.client.rpc('save_financial_group_eliminations',{
   ...saveArgs,p_to:jointQuery.to,p_expected_version:1,p_request_id:randomUUID(),
   p_entries:[{...jointEntries[1],documentMatchId:minorityJointMatch}],
  });
  assert.match(incomeRejected.error?.message??'',/GROUP_BATCH_NCI_REQUIRED/);
  const minorityBaselineBatch=await request('/api/financial-reporting/group-elimination-batches',{
   ...minorityJointRequest,entries:[],requestId:randomUUID(),reason:'Measure attributed results before reciprocal exclusions',
  });
  await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query:jointQuery,
   batchId:minorityBaselineBatch.id,expectedVersion:2,reason:'Approve the majority-owned acquisition baseline'});
  const minorityBaseline=await request(approvedAcquisitionsPath,jointAction);
  assert.equal(minorityBaseline.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(minorityBaseline));
  const minorityJointBatch=await request('/api/financial-reporting/group-elimination-batches',{
   ...minorityJointRequest,expectedVersion:2,
  });
  await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query:jointQuery,
   batchId:minorityJointBatch.id,expectedVersion:3,reason:'Approve matched balance and cash eliminations for the majority-owned group'});
  const minorityJoint=await request(approvedAcquisitionsPath,jointAction);
  assert.equal(minorityJoint.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(minorityJoint));
  assert.equal(minorityJoint.eliminationBatchVersion,3);
  assert.deepEqual(minorityJoint.profitAttribution,minorityBaseline.profitAttribution);
  assert.equal(minorityJoint.closingNci,minorityBaseline.closingNci);
  assert.equal(minorityJoint.closingParentEquity,minorityBaseline.closingParentEquity);
  assert.deepEqual(minorityJoint.rows.map(row=>[row.key,Number(row.after)-Number(minorityBaseline.rows.find(r=>r.key===row.key).after)]),
   [['assets',-60],['liabilities',-60],['equity',0]]);
  assert.equal(minorityJoint.cash.find(row=>row.key==='closing').adjustment,'0.0000');
  const consumedService={...jointEntries[1],documentMatchId:minorityJointMatch,
   incomeTreatment:'CURRENT_PERIOD_CONSUMED_SERVICE',
   reason:'Approved evidence confirms services were fully consumed during this reporting period'};
  const incompleteService=await actor.client.rpc('save_financial_group_eliminations',{
   ...saveArgs,p_to:jointQuery.to,p_expected_version:3,p_request_id:randomUUID(),
   p_entries:[{...consumedService,amount:'59'}],
  });
  assert.match(incompleteService.error?.message??'',/GROUP_BATCH_CONSUMED_SERVICE_UNSUPPORTED/);
  const serviceBatchRequest={
   ...minorityJointRequest,expectedVersion:3,requestId:randomUUID(),entries:[...minorityJointRequest.entries,consumedService],
   reason:'Approve gross offsets for the fully consumed documented services',
  };
  const serviceBatch=await request('/api/financial-reporting/group-elimination-batches',serviceBatchRequest).catch(async error=>{
   const probe=await actor.client.rpc('save_financial_group_eliminations',{...saveArgs,p_to:jointQuery.to,
    p_expected_version:3,p_request_id:serviceBatchRequest.requestId,p_reason:serviceBatchRequest.reason,
    p_entries:serviceBatchRequest.entries});
   if(probe.error)throw new Error(JSON.stringify(probe.error),{cause:error});
   throw error;
  });
  await request('/api/financial-reporting/group-elimination-batches',{action:'APPROVE',query:jointQuery,
   batchId:serviceBatch.id,expectedVersion:4,reason:'Confirm service consumption and verified original journals'});
  const withServices=await request(approvedAcquisitionsPath,jointAction);
  assert.equal(withServices.eliminationBatchVersion,4);
  for(const key of ['revenue','operatingExpenses']){
   const before=minorityJoint.income.find(row=>row.key===key);
   const after=withServices.income.find(row=>row.key===key);
   assert.equal(Number(after.after),Number(before.after)-60);
  }
  assert.deepEqual(withServices.profitAttribution,minorityJoint.profitAttribution);
  assert.equal(withServices.closingNci,minorityJoint.closingNci);
  assert.deepEqual(withServices.rows,minorityJoint.rows);
  assert.deepEqual(withServices.cash,minorityJoint.cash);
  await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
  await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
  await positionPanel.getByRole('heading',{name:'Non-controlling interests after acquisition',exact:true}).waitFor();
  await positionPanel.getByRole('heading',{name:'Cash flow after intercompany eliminations',exact:true}).waitFor();
  await positionPanel.getByRole('heading',{name:'Income after acquisition and intercompany eliminations',exact:true}).waitFor();
  await positionPanel.getByText('Approved elimination batch version 4',{exact:true}).waitFor();
  await writeFile(out+'/acquisition-nci-and-intercompany-balances.json',JSON.stringify(minorityJoint,null,2));
  await writeFile(out+'/acquisition-nci-and-consumed-services.json',JSON.stringify(withServices,null,2));
  await request(acquisitionPath,{...minorityJointKey,action:'REVOKE',reason:'Verify acquisition revocation blocks the majority-owned worksheet'});
  await request('/api/financial-reporting/group-approved-eliminations',jointQuery,422);
  console.log('PASS Reciprocal balances and cash reconcile without changing non-controlling interests');
  console.log('PASS Verified consumed service gross offsets preserve attributable profit and equity');

  const taxAccount=standalone.accounts.find(account=>account.kind==='LIABILITY'&&account.id==='2500');
  assert.ok(taxAccount,'Separate verified tax liability account is required for the minority fixture');
  const minorityQuery={...query,to:'2026-03-02'};
  const minorityKey={query:minorityQuery,id:randomUUID()};
  const minorityMeasurement={...taxMeasurement,considerationEvidence:minorityDocument.id,
   investmentLink:{...taxMeasurement.investmentLink,documentId:minorityDocument.id},
   fairValueBasis:{...taxMeasurement.fairValueBasis,taxEvidenceDocumentId:minorityDocument.id},
   identifiableItems:taxMeasurement.identifiableItems.map(item=>({...item,
    id:item.id===newLiability.id?taxAccount.id:item.id,measurementEvidence:minorityDocument.id,
   })),
   continuityBasis:{...taxMeasurement.continuityBasis,evidenceDocumentId:minorityDocument.id,schedules:[
    {accountId:upliftAccount.id,usefulLifeDays:60,deferredTaxLiabilityAccountId:taxAccount.id},
   ]},
  };
  const minorityBatchRequest={
   ...save,query:minorityQuery,entries:[],expectedVersion:0,requestId:randomUUID(),reason:'Confirm scope before allocating post-acquisition loss',
  };
  const unapprovedMinorityBatch=await request('/api/financial-reporting/group-elimination-batches',minorityBatchRequest,422);
  assert.equal(unapprovedMinorityBatch.error,'GROUP_BATCH_NCI_REQUIRED');
  await request(acquisitionPath,{...minorityKey,action:'SAVE',measurement:minorityMeasurement});
  await request(acquisitionPath,{...minorityKey,action:'APPROVE',reason:'Approve the acquisition and schedules for fixed 80 percent ownership'});
  const minorityBatch=await request('/api/financial-reporting/group-elimination-batches',minorityBatchRequest);
  await request('/api/financial-reporting/group-elimination-batches',{
   action:'APPROVE',query:minorityQuery,batchId:minorityBatch.id,expectedVersion:1,reason:'Approve majority-owned subsidiary period',
  });
  const minority=await request(approvedAcquisitionsPath,{action:'ACQUISITION_POSITION',query:minorityQuery});
  assert.equal(minority.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(minority));
  assert.equal(minority.goodwill,'1072.0000');
  assert.deepEqual(minority.profitAttribution,{total:'-1160.0000',parent:'-928.0000',nci:'-232.0000'});
  assert.equal(minority.closingNci,'800.0000');
  assert.equal(minority.closingParentEquity,'-428.0000');
  await page.getByLabel('To date',{exact:true}).fill(minorityQuery.to);
  await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
  await positionPanel.getByText('Non-controlling interests after acquisition',{exact:true}).waitFor();
  await writeFile(out+'/acquisition-nci-attribution.json',JSON.stringify(minority,null,2));
  await request(acquisitionPath,{...minorityKey,action:'REVOKE',reason:'Prepare the independently documented dividend fixture'});
  async function postDividend({organization,type,debit,credit,amount,bankAccountId,direction,activity}){
   const c=randomUUID();
   sql(`insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by)
    values('${c}','${organization}','QA_GROUP_DIVIDEND','Declared ordinary dividend','${type}','${actor.id}')`);
   let workspace=await rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:query.from});
   for(const [id,normal] of [[debit,'DEBIT'],[credit,'CREDIT']]){
    if(workspace.chart.some(account=>account.id===id))continue;
    await rpc('save_financial_chart_account',{p_org:organization,p_code:id,p_parent:id.slice(0,4),
     p_name_ar:'حساب توزيع الاختبار',p_name_en:'Dividend acceptance account',p_normal_side:id.startsWith('3300')?'CREDIT':normal,
     p_is_postable:true,p_is_active:true,p_expected_version:0,p_reason:'Create a dedicated dividend fixture account'});
    workspace=await rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:query.from});
   }
   const rules=workspace.policy.rules.map(rule=>Object.fromEntries(Object.entries(rule).filter(([key])=>
    ['detailed','eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId','cashActivity'].includes(key))));
   rules.push({detailed:true,eventType:'ADJUSTMENT',sourceModule:'OPERATIONAL_CONSOLE',classificationId:c+':BASE',
    cashDirection:'NON_CASH',debitAccountId:debit,creditAccountId:credit});
   const incoming=direction==='INFLOW';
   rules.push({detailed:true,eventType:'SETTLEMENT',sourceModule:'OPERATIONAL_CONSOLE',classificationId:c+':BASE',
    cashDirection:direction,debitAccountId:incoming?'1000':credit,creditAccountId:incoming?debit:'1000',cashActivity:activity});
   const policy=await request('/api/financial-reporting/policy',{action:'save',organization,fiscalStart:query.from,
    expectedVersion:workspace.policy.status==='DRAFT'?workspace.policy.version:0,rules,reason:'Fixture dividend source policy'});
   await request('/api/financial-reporting/policy',{action:'approve',id:policy.id,expectedVersion:policy.version});
   const flow=await request('/api/liquidity',{kind:'flow',organization_id:organization,account_id:bankAccountId,
    direction,title:'Ordinary dividend',due_date:minorityQuery.to,amount,base_amount:amount,currency:'SAR',
    status:'CONFIRMED',source:'ACCOUNTING'},201);
   async function prepareEvent(eventType,description,value,cashDirection,obligations,links){
    const id=await command({action:'CREATE',payload:{organization_id:organization,entity_id:null,counterparty_id:null,
     event_type:eventType,source_module:'OPERATIONAL_CONSOLE',source_event_key:'group-dividend:'+randomUUID(),
     event_date:minorityQuery.to,due_date:null,base_currency:'SAR',description,
     lines:[{line_number:1,cost_center_id:null,description,classification_id:c,amount:value,base_amount:value,
      currency:'SAR',exchange_rate:1,cash_direction:cashDirection,vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],
     obligations,links,
    }});
    for(const status of ['PLANNED','COMMITTED'])
     await command({action:'TRANSITION',organization_id:organization,event_id:id,status,note:'Native dividend fixture'});
    await command({action:'APPROVE',organization_id:organization,event_id:id,note:'Approve the original dividend source'});
    return id;
   }
   const id=await prepareEvent('ADJUSTMENT','Documented declared dividend',amount,'NON_CASH',[
    {obligation_key:'ordinary-dividend',obligation_type:incoming?'RECEIVABLE':'PAYABLE',
     settleable_amount:amount,settleable_base_amount:amount,currency:'SAR',base_currency:'SAR',exchange_rate:1},
   ],[{link_type:'CASH_FLOW',target_module:'liquidity_flows',target_record_id:flow.id}]);
   await command({action:'TRANSITION',organization_id:organization,event_id:id,status:'ACTUAL',note:'Post declared dividend'});
   return {id,async settle(value){
    const balance=await actor.client.from('financial_event_obligation_balances').select('obligation_id')
     .eq('organization_id',organization).eq('event_id',id).single();
    assert.ifError(balance.error);
    const eventId=await prepareEvent('SETTLEMENT','Documented dividend payment',value,direction,[],
     [{link_type:'SETTLEMENT_OF',related_event_id:id}]);
    const posted=await command({action:'POST_SETTLEMENT',organization_id:organization,event_id:eventId,
     account_id:bankAccountId,direction,settlement_date:minorityQuery.to,amount:value,base_amount:value,currency:'SAR',exchange_rate:1,
     allocations:[{obligation_id:balance.data.obligation_id,flow_id:flow.id,amount:value,base_amount:value,
      flow_amount:value,flow_currency:'SAR',flow_exchange_rate:1}]});
    assert.equal(posted.status,'POSTED');
    return eventId;
   }};
  }
  const childBanks=await actor.client.from('liquidity_accounts').select('id')
   .eq('organization_id',subsidiary).eq('active',true).eq('currency','SAR').is('entity_id',null).order('id').limit(1);
  assert.ifError(childBanks.error);assert.ok(childBanks.data.length);
  const childDividend=await postDividend({organization:subsidiary,type:'EQUITY',debit:'330098',credit:'210098',
   amount:100,bankAccountId:childBanks.data[0].id,direction:'OUTFLOW',activity:'FINANCING'});
  const parentDividend=await postDividend({organization:parent,type:'REVENUE',debit:'110098',credit:'410061',
   amount:80,bankAccountId:bankId,direction:'INFLOW',activity:'INVESTING'});
  const {id:subsidiaryEventId}=childDividend,{id:parentEventId}=parentDividend;
  const dividendKey={query:minorityQuery,id:randomUUID()};
  await request(acquisitionPath,{...dividendKey,action:'SAVE',measurement:{...minorityMeasurement,
   ordinaryDividend:{parentEventId,subsidiaryEventId,evidenceDocumentId:minorityDocument.id},
  }});
  await request(acquisitionPath,{...dividendKey,action:'APPROVE',reason:'Review the paired ordinary dividend declared and unpaid'});
  const dividendBatch=await request('/api/financial-reporting/group-elimination-batches',{
   ...save,query:minorityQuery,entries:[],expectedVersion:1,requestId:randomUUID(),reason:'Approve closing source including declared distributions',
  });
  await request('/api/financial-reporting/group-elimination-batches',{
   action:'APPROVE',query:minorityQuery,batchId:dividendBatch.id,expectedVersion:2,reason:'Approve paired distribution review period',
  });
  const withDividend=await request(approvedAcquisitionsPath,{action:'ACQUISITION_POSITION',query:minorityQuery});
  assert.equal(withDividend.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(withDividend));
  assert.deepEqual(withDividend.profitAttribution,minority.profitAttribution);
  assert.equal(withDividend.closingNci,'780.0000');
  assert.equal(withDividend.closingParentEquity,minority.closingParentEquity);
  assert.equal(withDividend.rows.find(row=>row.key==='liabilities').after,'5220.0000');
  await writeFile(out+'/acquisition-ordinary-dividend.json',JSON.stringify(withDividend,null,2));
  await request(acquisitionPath,{...dividendKey,action:'REVOKE',reason:'Verify payments require matching cash journal sources'});
  const unpairedKey={query:minorityQuery,id:randomUUID()};
  const unpairedMeasurement={...minorityMeasurement,ordinaryDividend:{
   parentEventId,subsidiaryEventId,evidenceDocumentId:minorityDocument.id,
   parentPayment:{parentEventId:randomUUID(),subsidiaryEventId:randomUUID(),evidenceDocumentId:minorityDocument.id},
  }};
  await request(acquisitionPath,{...unpairedKey,action:'SAVE',measurement:unpairedMeasurement});
  await request(acquisitionPath,{...unpairedKey,action:'APPROVE',reason:'Verify reporting rejects absent settlement journal evidence'});
  assert.equal((await request(approvedAcquisitionsPath,{action:'ACQUISITION_POSITION',query:minorityQuery})).reason,'DIVIDEND_SOURCE_UNRECONCILED');
  await request(acquisitionPath,{...unpairedKey,action:'REVOKE',reason:'Replace missing references with native settlement vouchers'});
  const childPayment=await childDividend.settle(50);
  const parentReceipt=await parentDividend.settle(50);
  const minorityPayment=await childDividend.settle(10);
  const paidKey={query:minorityQuery,id:randomUUID()};
  await request(acquisitionPath,{...paidKey,action:'SAVE',measurement:{...minorityMeasurement,ordinaryDividend:{
   parentEventId,subsidiaryEventId,evidenceDocumentId:minorityDocument.id,
   parentPayment:{parentEventId:parentReceipt,subsidiaryEventId:childPayment,evidenceDocumentId:minorityDocument.id},
   minorityPayment:{subsidiaryEventId:minorityPayment,evidenceDocumentId:minorityDocument.id},
  }}});
  await request(acquisitionPath,{...paidKey,action:'APPROVE',reason:'Match posted cash vouchers to the documented ordinary distribution'});
  const paidBatch=await request('/api/financial-reporting/group-elimination-batches',{
   ...save,query:minorityQuery,entries:[],expectedVersion:2,requestId:randomUUID(),reason:'Capture the source after bank settlement',
  });
  await request('/api/financial-reporting/group-elimination-batches',{
   action:'APPROVE',query:minorityQuery,batchId:paidBatch.id,expectedVersion:3,reason:'Verify the approved distribution settlement period',
  });
  const paid=await request(approvedAcquisitionsPath,{action:'ACQUISITION_POSITION',query:minorityQuery});
  assert.equal(paid.status,'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW',JSON.stringify(paid));
  const [distribution]=paid.dividendEliminations;
  assert.equal(distribution.parentOutstanding,'30.0000');
  assert.equal(distribution.minorityOutstanding,'10.0000');
  assert.equal(distribution.minorityCashPaid,'10.0000');
  assert.deepEqual(distribution.internalCash,{date:minorityQuery.to,amount:'50.0000',
   receiptActivity:'INVESTING',paymentActivity:'FINANCING'});
  assert.deepEqual(paid.profitAttribution,withDividend.profitAttribution);
  assert.equal(paid.closingNci,withDividend.closingNci);
  const position=(report,key)=>Number(report.rows.find(row=>row.key===key).after);
  for(const key of ['assets','liabilities'])assert.equal(position(paid,key),position(withDividend,key)-10);
  assert.equal(position(paid,'equity'),position(withDividend,'equity'));
  const cash=Object.fromEntries(paid.cash.map(row=>[row.key,row]));
  assert.equal(cash.investing.adjustment,'-50.0000');
  assert.equal(cash.financing.adjustment,'50.0000');
  assert.equal(cash.financing.after,'-10.0000');
  assert.equal(cash.closing.adjustment,'0.0000');
  assert.equal(Number(cash.closing.after),Number(cash.opening.after)+Number(cash.movement.after));
  await writeFile(out+'/acquisition-ordinary-dividend-settlement.json',JSON.stringify(paid,null,2));
  console.log('PASS Posted dividend settlement reconciles group position, profit and cash flow');
  await page.getByRole('button',{name:'Refresh company sources',exact:true}).click();
  await worksheet.getByRole('button',{name:'Review acquisition carry-forward',exact:true}).click();
  await positionPanel.getByRole('heading',{name:'Cash flow after eliminating internal dividend payments'}).waitFor();
  await positionPanel.getByRole('columnheader',{name:'Paid to non-controlling owners'}).waitFor();
  console.log('PASS Browser shows adjusted cash flow and external dividend payments');
  const duplicateMatch=await jointDocument(childPayment,parentReceipt);
  const [parentCashSource,childCashSource]=await Promise.all([raw(parent),raw(subsidiary)]);
  const receiptLine=parentCashSource.events.find(event=>event.id===parentReceipt).lines[0];
  const paymentLine=childCashSource.events.find(event=>event.id===childPayment).lines[0];
  const duplicatedCash={...cashEntry,id:randomUUID(),date:minorityQuery.to,amount:'50',documentMatchId:duplicateMatch,
   debitSource:ref(subsidiary,childPayment,paymentLine,paymentLine.resolvedPosting.creditAccountId),
   creditSource:ref(parent,parentReceipt,receiptLine,receiptLine.resolvedPosting.debitAccountId)};
  const overlappingBatch=await request('/api/financial-reporting/group-elimination-batches',{
   ...save,query:minorityQuery,entries:[duplicatedCash],expectedVersion:3,requestId:randomUUID(),
   reason:'Verify a dividend settlement is never removed twice',
  });
  await request('/api/financial-reporting/group-elimination-batches',{
   action:'APPROVE',query:minorityQuery,batchId:overlappingBatch.id,expectedVersion:4,
   reason:'Verify the combined review detects the original duplicate bank vouchers',
  });
  assert.equal((await request(approvedAcquisitionsPath,{action:'ACQUISITION_POSITION',query:minorityQuery})).reason,'OVERLAPPING_ELIMINATION');
  console.log('PASS The combined review rejects a dividend payment already used by the cash batch');
  await request(acquisitionPath,{...paidKey,action:'REVOKE',reason:'Restore the original disposable group fixture'});
  const {verifyGroupInventoryMargin}=await import('./verify-group-inventory-margin.mjs');
  await verifyGroupInventoryMargin({actor,request,rpc,command,sql,jointDocument,parent,subsidiary,query:{...query,to:'2026-02-28'},out,
   acquisitionPath,approvedAcquisitionsPath,documentPath,page,worksheet,positionPanel,
   acquisitionMeasurement:{...dayMeasurement,considerationEvidence:minorityDocument.id,
    investmentLink:{...investmentLink,documentId:minorityDocument.id},
    identifiableItems:dayMeasurement.identifiableItems.map(item=>({...item,measurementEvidence:minorityDocument.id})),
    continuityBasis:{treatment:'NO_SUBSEQUENT_ADJUSTMENTS',evidenceDocumentId:minorityDocument.id},
   }});
 }finally{
  sql(`update private.financial_group_control_assessments set economic_interest_percent=100,
   voting_interest_percent=100 where id='${control}'`);
 }





 await writeFile(out+'/group-source-bound-actual-preview.json',JSON.stringify(result,null,2));
 return{parent,subsidiary,revenue,expenseEvent,status:result.status,amount:'60.0000',sourcesUnchanged:true,revokedChildDenied:true};
}
