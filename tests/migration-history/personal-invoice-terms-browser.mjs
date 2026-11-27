import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyInvoiceTerms({app, owner, ownerContext, otherContext, value}) {
  const endpoint = app+'/api/personal-income/receivable-terms';
  const client = owner.client;
  value(await client.from('personal_income_profiles').insert({
    seller_name:'Synthetic seller',vat_number:'300000000000003',effective_from:'2026-01-01',
  }));
  const document = {
    p_customer:'Synthetic receivable browser client',p_description:'QA only',p_date:'2026-02-01',
    p_net:10000,p_tax:1500,
  };
  const invoice = value(await client.rpc('record_personal_income_document',{
    ...document,p_mode:'EVIDENCE',p_reference:'SYNTHETIC-QA',p_request:randomUUID(),
  }));
  const draft = value(await client.rpc('record_personal_income_document',{
    ...document,p_customer:'Synthetic tax draft',p_mode:'INVOICE',p_reference:null,p_request:randomUUID(),
  }));
  assert.ok(invoice.receivable_id);
  assert.equal(draft.receivable_id,null);

  const page = await ownerContext.newPage();
  page.setDefaultTimeout(20000);
  async function openTerms(locale, label) {
    await page.goto(app+'/'+locale+'/vat?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
    const summary = page.locator('summary').filter({hasText:document.p_customer});
    await summary.click();
    const details = page.locator('details').filter({has:summary});
    await details.getByRole('button',{name:label,exact:true}).click();
    return details;
  }
  const english = await openTerms('en','Receivable due date and classification');
  await english.getByLabel('Due date',{exact:true}).fill('2026-02-03');
  await english.getByLabel('Classification',{exact:true}).selectOption('EXCELLENT');
  await english.getByLabel('Effective date',{exact:true}).fill('2026-02-01');
  await english.getByRole('button',{name:'Save receivable terms',exact:true}).click();
  await english.getByText('Receivable terms saved.',{exact:true}).waitFor();

  const termsAt = async date=>value(await client.rpc('read_personal_invoice_hawl_at_cutoff',{
    p_document:invoice.id,p_as_of:date,
  }));
  const original = await termsAt('2026-02-04');
  assert.equal(original.status,'VERIFIED');
  assert.equal(original.netEligibleReceivable,10000);
  assert.equal(original.receivableEligibleSince,'2026-02-03');

  const badTerms = {
    documentId:invoice.id,requestId:randomUUID(),dueDate:'2026-02-03',
    classification:'BAD',effectiveDate:'2026-02-05',
  };
  async function post(context,data,origin=app) {
    return context.request.post(endpoint,{data,headers:{origin}});
  }
  async function expectStatus(response,status) {
    assert.equal(response.status(),status,await response.text());
  }
  await expectStatus(await post(ownerContext,badTerms),200);
  await expectStatus(await post(ownerContext,badTerms),200);
  await expectStatus(await post(ownerContext,{...badTerms,classification:'GOOD'}),409);
  await expectStatus(await post(otherContext,badTerms),404);
  await expectStatus(await post(ownerContext,{...badTerms,documentId:draft.id,requestId:randomUUID()}),404);
  await expectStatus(await post(ownerContext,badTerms,'https://unrelated.invalid'),403);
  await expectStatus(await otherContext.request.get(endpoint+'?document='+invoice.id),404);

  const bank = value(await client.from('asset_accounts').insert({
    user_id:owner.user.id,asset_type:'BANK',name:'QA invoice bank',currency:'SAR',unit:'SAR',
    is_zakatable:true,ownership_scope:'PERSONAL',metadata:{},
  }).select('id').single());
  const transfer = {
    action:'COLLECT',source_id:invoice.receivable_id,destination_id:bank.id,
    request_id:randomUUID(),date:'2026-02-06',amount:4000,notes:'Synthetic partial collection',
  };
  const receipt = value(await client.rpc('transfer_personal_financial_account',{p_payload:transfer}));
  assert.deepEqual(value(await client.rpc('transfer_personal_financial_account',{p_payload:transfer})),receipt);
  const duringBad = await termsAt('2026-02-06');
  assert.equal(duringBad.netEligibleReceivable,0);
  assert.equal(duringBad.receivableEligibleSince,null);

  const arabic = await openTerms('ar','الاستحقاق وتصنيف الذمة');
  const history = arabic.getByRole('table');
  await history.getByText('سيئ',{exact:true}).waitFor();
  assert.equal(await history.getByText('سيئ',{exact:true}).count(),1);
  await arabic.getByLabel('التصنيف',{exact:true}).selectOption('GOOD');
  await arabic.getByLabel('تاريخ نفاذ التصنيف',{exact:true}).fill('2026-02-08');
  await arabic.getByRole('button',{name:'حفظ شروط الذمة',exact:true}).click();
  await arabic.getByText('تم حفظ شروط الذمة.',{exact:true}).waitFor();
  const afterReload = await openTerms('ar','الاستحقاق وتصنيف الذمة');
  await afterReload.getByRole('table').getByText('جيد',{exact:true}).waitFor();

  const recovered = await termsAt('2026-02-08');
  assert.equal(recovered.netEligibleReceivable,6521.74);
  assert.equal(recovered.receivableEligibleSince,'2026-02-08');
  const collection = value(await client.rpc('read_personal_invoice_collection_lots_at_cutoff',{
    p_document:invoice.id,p_as_of:'2026-02-08',
  }));
  assert.equal(collection.status,'VERIFIED');
  assert.equal(collection.rows.length,1);
  const [lot] = collection.rows;
  assert.deepEqual([lot.transferId,lot.grossCollected,lot.netCollected,lot.taxCollected],
    [receipt.transfer_id,4000,3478.26,521.74]);
  assert.ok(lot.bankLotId);
  console.log('PASS invoice terms in both locales, owner isolation, retry, partial bank collection and dated re-eligibility');
  await page.close();
}
