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
   classification_id:investmentAccount.classification,amount:1200,base_amount:1200,currency:'SAR',exchange_rate:1,
   cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[],links:[],
 }});
 for(const status of ['PLANNED','COMMITTED'])await command({action:'TRANSITION',organization_id:parent,event_id:investmentEvent,status,note:'Actual acquisition acceptance'});
 await command({action:'APPROVE',organization_id:parent,event_id:investmentEvent,note:'Approve acquisition investment source'});
 await command({action:'TRANSITION',organization_id:parent,event_id:investmentEvent,status:'ACTUAL',note:'Post acquisition investment source'});
 const posted=(await raw(parent)).events.find(event=>event.id===investmentEvent);
 assert.ok(posted);
 const investmentLink={accountId:investmentAccount.accountId,eventId:investmentEvent,lineId:posted.lines[0].id,documentId:document.id};
 const linkedKey={query,id:randomUUID()};
 const linkSave={...linkedKey,action:'SAVE',measurement:{...measurement,investmentLink}};
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
 assert.deepEqual(linkedBasis.linkedInvestment,{accountId:investmentAccount.accountId,balance:'1200.0000'});
 assert.equal(linkedBasis.parentInvestmentAccountGroupBalance,'1200.0000');
 await writeFile(out+'/verified-acquisition-investment-link.json',JSON.stringify({linkedBasis,investmentLink},null,2));

 await writeFile(out+'/group-source-bound-actual-preview.json',JSON.stringify(result,null,2));
 return{parent,subsidiary,revenue,expenseEvent,status:result.status,amount:'60.0000',sourcesUnchanged:true,revokedChildDenied:true};
}
