import {describe,it,expect} from 'vitest';
import {buildUnsignedZatcaXml} from './zatca-phase2-xml';

const draft={organization_id:'a800b1c2-df4a-4a79-9b91-4a451ce2858a',invoice_number:'INV-2026-0001',invoice_category:'STANDARD',issue_date:'2026-10-22',issue_time:'12:00',seller_name:'شركة الاختبار',seller_vat_number:'312345678901233',seller_address:'King Fahd Road',seller_building_number:'1234',seller_district:'Olaya',seller_additional_number:'5678',seller_postal_code:'12345',seller_city:'Riyadh',buyer_name:'Customer LLC',buyer_vat_number:'312345678901233',buyer_address:'Customer street',buyer_building_number:'4321',buyer_district:'Olaya',buyer_city:'Riyadh',buyer_postal_code:'54321',lines:[{item_name:'Consulting service',quantity:2,unit_price:100,tax_category:'S',tax_rate:15}]};
const context={invoiceUuid:'a800b1c2-df4a-4a79-9b91-4a451ce2858b',invoiceCounter:'1',previousInvoiceHash:Buffer.alloc(32).toString('base64'),supplyDate:'2026-10-22',sellerId:{scheme:'CRN',value:'1010000000'},paymentMeansCode:'30'};
describe('unsigned ZATCA XML preparation',()=>{
 it('uses the current seller identification schemes and supports buyer TIN without punctuation in identifiers',()=>{
  expect(()=>buildUnsignedZatcaXml(draft,{...context,sellerId:{scheme:'NAT',value:'1234'}})).toThrow();
  expect(()=>buildUnsignedZatcaXml(draft,{...context,sellerId:{scheme:'CRN',value:'101-123'}})).toThrow();
  expect(()=>buildUnsignedZatcaXml(draft,{...context,buyerId:{scheme:'TIN',value:'101 123'}})).toThrow();
  expect(buildUnsignedZatcaXml(draft,{...context,buyerId:{scheme:'TIN',value:'101123'}}).xml).toContain('schemeID="TIN">101123');
 });
 it('does not fabricate optional buyer additional number or region to satisfy legacy SDK checks',()=>{
  const without=buildUnsignedZatcaXml(draft,context).xml.split('<cac:AccountingCustomerParty>')[1].split('</cac:AccountingCustomerParty>')[0];
  expect(without).not.toContain('PlotIdentification');expect(without).not.toContain('CountrySubentity');
  const withAdditional=buildUnsignedZatcaXml({...draft,buyer_additional_number:'1234'},context).xml;
  expect(withAdditional).toContain('<cbc:PlotIdentification>1234</cbc:PlotIdentification>');
 });

 it('rejects exemption reasons attached to a standard-rate line rather than exporting contradictory VAT data',()=>{
  for(const reason of [{tax_exemption_reason_code:'VATEX-SA-29'},{tax_exemption_reason:'Exempt service'}])expect(()=>buildUnsignedZatcaXml({...draft,lines:[{...draft.lines[0],...reason}]},context)).toThrow('STANDARD_TAX_EXEMPTION_NOT_ALLOWED');
 });
 it.each(['STANDARD','SIMPLIFIED'])('maps all three %s document types to explicit UBL codes',category=>{
  for(const[type,code]of [['INVOICE','388'],['CREDIT_NOTE','381'],['DEBIT_NOTE','383']]){
   const result=buildUnsignedZatcaXml({...draft,invoice_category:category,document_type:type,...(type==='INVOICE'?{}:{billing_reference:'ORIGINAL-10',note_reason:'Returned service'})},context);
   expect(result.documentTypeCode).toBe(code);expect(result.transactionTypeCode).toBe(category==='STANDARD'?'0100000':'0200000');
   expect(result.xml).toContain(`name="${result.transactionTypeCode}">${code}</cbc:InvoiceTypeCode>`);
   expect(result.stage).toBe('UNSIGNED_PREPARATION');expect(result.xml).not.toContain('ds:Signature');expect(result.xml).not.toContain('<cbc:ID>QR</cbc:ID>');
   if(type!=='INVOICE'){expect(result.xml).toContain('<cac:InvoiceDocumentReference><cbc:ID>ORIGINAL-10</cbc:ID>');expect(result.xml).toContain('<cbc:InstructionNote>Returned service</cbc:InstructionNote>')}
  }
 });
 it('preserves identities and deterministic chain inputs without allocating a new counter',()=>{
  const a=buildUnsignedZatcaXml(draft,context),b=buildUnsignedZatcaXml(draft,context);
  expect(a.xml).toBe(b.xml);expect(a.xml).toContain('<cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID>');expect(a.xml).toContain(context.previousInvoiceHash);expect(a.xml).toContain('<cbc:IssueTime>12:00:00</cbc:IssueTime>');
 });
 it('retains source currency and converts only the separate SAR VAT total',()=>{
  const x=buildUnsignedZatcaXml({...draft,currency:'USD',exchange_rate:3.75},context);
  expect(x.totals.payable_amount).toBe('230.00');expect(x.xml).toContain('<cbc:TaxAmount currencyID="SAR">112.50</cbc:TaxAmount>');expect(x.xml).toContain('<cbc:PayableAmount currencyID="USD">230.00</cbc:PayableAmount>');
 });
 it('represents discounts once at line level, with matching net, tax and gross',()=>{
  const x=buildUnsignedZatcaXml({...draft,lines:[{...draft.lines[0],discount_amount:20}]},context);
  expect(x.totals.tax_exclusive_amount).toBe('180.00');expect(x.totals.payable_amount).toBe('207.00');expect(x.xml).toContain('<cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>');expect(x.xml).toContain('<cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>');
 });
 it('uses grouped VAT rounding even when many individually tiny lines round down',()=>{
  const x=buildUnsignedZatcaXml({...draft,lines:Array.from({length:10},()=>({...draft.lines[0],quantity:1,unit_price:0.03}))},context);
  expect(x.totals.tax_total_amount).toBe('0.05');expect(x.totals.payable_amount).toBe('0.35');
 });
 it('escapes Arabic text and metacharacters, rejecting forbidden XML characters',()=>{
  const x=buildUnsignedZatcaXml({...draft,seller_name:'شركة & <اختبار> "آمنة"'},context);
  expect(x.xml).toContain('شركة &amp; &lt;اختبار&gt; &quot;آمنة&quot;');expect(()=>buildUnsignedZatcaXml({...draft,seller_name:'Bad\u0000name'},context)).toThrow('XML_CHARACTER_INVALID');
 });
 it('requires an original invoice number rather than substituting an internal UUID',()=>{
  expect(()=>buildUnsignedZatcaXml({...draft,document_type:'CREDIT_NOTE',preceding_invoice_id:context.invoiceUuid,note_reason:'Correction'},context)).toThrow('ORIGINAL_INVOICE_NUMBER_REQUIRED');
 });
 it.each(['Z','E','O'])('keeps %s exemption reasons and zero tax',tax_category=>{
  const x=buildUnsignedZatcaXml({...draft,lines:[{...draft.lines[0],tax_category,tax_rate:0,tax_exemption_reason_code:tax_category==='O'?'VATEX-SA-OOS':'VATEX-SA-29',tax_exemption_reason:'QA reason'}]},context);
  expect(x.totals.tax_total_amount).toBe('0.00');expect(x.xml).toContain('<cbc:TaxExemptionReason>QA reason</cbc:TaxExemptionReason>');
 });
 it('rejects mixed outside-scope categories and absent outside-scope reasons',()=>{
  const outside={...draft.lines[0],tax_category:'O',tax_rate:0};
  expect(()=>buildUnsignedZatcaXml({...draft,lines:[outside]},context)).toThrow('XML_TAX_REASON_REQUIRED');
  expect(()=>buildUnsignedZatcaXml({...draft,lines:[draft.lines[0],{...outside,tax_exemption_reason_code:'VATEX-SA-OOS',tax_exemption_reason:'Outside'}]},context)).toThrow('OUT_OF_SCOPE_CATEGORY_MIXED');
 });
 it('does not merge incompatible exemption reasons into an arbitrary first reason',()=>{
  const l={...draft.lines[0],tax_category:'E',tax_rate:0,tax_exemption_reason_code:'VATEX-SA-29',tax_exemption_reason:'Financial service'};
  expect(()=>buildUnsignedZatcaXml({...draft,lines:[l,{...l,tax_exemption_reason_code:'VATEX-SA-29-7',tax_exemption_reason:'Other reason'}]},context)).toThrow('XML_TAX_GROUP_REASON_MISMATCH');
 });
 it('rejects malformed chain state, unsupported payment codes and mismatched instructions',()=>{
  expect(()=>buildUnsignedZatcaXml(draft,{...context,previousInvoiceHash:'bad'})).toThrow('PREVIOUS_INVOICE_HASH_INVALID');
  expect(()=>buildUnsignedZatcaXml(draft,{...context,invoiceCounter:'0'})).toThrow();
  expect(()=>buildUnsignedZatcaXml(draft,{...context,paymentMeansCode:'999'})).toThrow();
  expect(()=>buildUnsignedZatcaXml({...draft,payment_means_code:'10'},context)).toThrow('PAYMENT_MEANS_MISMATCH');
 });
 it('requires a stable buyer identifier for standard invoices and tolerates anonymous simplified buyers',()=>{
  const {buyer_vat_number,...without}=draft;expect(()=>buildUnsignedZatcaXml(without,context)).toThrow('STANDARD_BUYER_ID_REQUIRED');
  expect(buildUnsignedZatcaXml({...without,invoice_category:'SIMPLIFIED',buyer_name:null,buyer_address:null,buyer_city:null},context).xml).toContain('<cac:AccountingCustomerParty/>');
 });
 it('fails closed on unsupported monetary inputs instead of silently stripping them',()=>{
  expect(()=>buildUnsignedZatcaXml({...draft,prepaid_amount:10},context)).toThrow();
  expect(()=>buildUnsignedZatcaXml({...draft,lines:[{...draft.lines[0],discount_amount:7.505}]},context)).toThrow('XML_DISCOUNT_PRECISION_INVALID');
 });
});
