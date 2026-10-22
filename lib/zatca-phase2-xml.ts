import Decimal from 'decimal.js';
import {z} from 'zod';
import {calculateVatEInvoiceDraft,vatEInvoiceDraftSchema,type VatEInvoiceDraft} from './vat-einvoice-draft';

/** Preparation only. This document has NO cryptographic stamp or QR and must not
 * be submitted, labelled compliant, or used to transition an invoice to ISSUED.
 * Identity, counter and previous hash must come from a future atomic unit ledger.
 */
export const zatcaXmlContextSchema=z.object({
  invoiceUuid:z.string().uuid(),
  invoiceCounter:z.string().regex(/^[1-9][0-9]*$/).max(30),
  previousInvoiceHash:z.string().min(1).max(128),
  supplyDate:z.string().date(),
  sellerId:z.object({scheme:z.enum(['CRN','MOM','MLS','700','SAG','NAT','GCC','IQA','PAS','OTH']),value:z.string().trim().min(1).max(100)}),
  buyerId:z.object({scheme:z.enum(['CRN','MOM','MLS','700','SAG','NAT','GCC','IQA','PAS','OTH']),value:z.string().trim().min(1).max(100)}).optional(),
  paymentMeansCode:z.enum(['10','30','42','48','1']),
}).strict();
export type ZatcaXmlContext=z.infer<typeof zatcaXmlContextSchema>;

const escapeXml=(value:unknown)=>{
  const s=String(value??'');
  if(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(s))throw Error('XML_CHARACTER_INVALID');
  return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
};
const tag=(name:string,value:unknown,attributes='')=>`<${name}${attributes}>${escapeXml(value)}</${name}>`;
const vatScheme='<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>';
const category=(code:string,rate:string)=>tag('cbc:ID',code)+(code==='O'?'':tag('cbc:Percent',rate))+vatScheme;

function party(d:VatEInvoiceDraft,side:'seller'|'buyer',identifier?:ZatcaXmlContext['buyerId']){
  const isSeller=side==='seller',name=d[`${side}_name`],vat=d[`${side}_vat_number`];
  if(!isSeller&&!name&&!vat&&!identifier)return '<cac:AccountingCustomerParty/>';
  const id=identifier?`<cac:PartyIdentification>${tag('cbc:ID',identifier.value,` schemeID="${identifier.scheme}"`)}</cac:PartyIdentification>`:'';
  const address=(d[`${side}_address`]||d[`${side}_city`])?`<cac:PostalAddress>${tag('cbc:StreetName',d[`${side}_address`])}${d[`${side}_building_number`]?tag('cbc:BuildingNumber',d[`${side}_building_number`]):''}${d[`${side}_additional_number`]?tag('cbc:PlotIdentification',d[`${side}_additional_number`]):''}${tag('cbc:CitySubdivisionName',d[`${side}_district`])}${tag('cbc:CityName',d[`${side}_city`])}${tag('cbc:PostalZone',d[`${side}_postal_code`])}<cac:Country>${tag('cbc:IdentificationCode',d[`${side}_country_code`])}</cac:Country></cac:PostalAddress>`:'';
  return `<cac:Accounting${isSeller?'Supplier':'Customer'}Party><cac:Party>${id}${address}${vat?`<cac:PartyTaxScheme>${tag('cbc:CompanyID',vat)}${vatScheme}</cac:PartyTaxScheme>`:''}${name?`<cac:PartyLegalEntity>${tag('cbc:RegistrationName',name)}</cac:PartyLegalEntity>`:''}</cac:Party></cac:Accounting${isSeller?'Supplier':'Customer'}Party>`;
}

export function buildUnsignedZatcaXml(input:unknown,contextInput:unknown){
  const d=vatEInvoiceDraftSchema.strict().parse(input),context=zatcaXmlContextSchema.parse(contextInput);
  const decoded=Buffer.from(context.previousInvoiceHash,'base64');
  if(decoded.toString('base64')!==context.previousInvoiceHash||!(decoded.length===32||/^[a-fA-F0-9]{64}$/.test(decoded.toString('ascii'))))throw Error('PREVIOUS_INVOICE_HASH_INVALID');
  if(d.invoice_category==='STANDARD'&&!d.buyer_vat_number&&!context.buyerId)throw Error('STANDARD_BUYER_ID_REQUIRED');
  if(d.payment_means_code&&d.payment_means_code!==context.paymentMeansCode)throw Error('PAYMENT_MEANS_MISMATCH');
  if(d.document_type!=='INVOICE'&&!d.billing_reference?.trim())throw Error('ORIGINAL_INVOICE_NUMBER_REQUIRED');
  const categories=new Set(d.lines.map(l=>l.tax_category));
  if(categories.has('O')&&categories.size>1)throw Error('OUT_OF_SCOPE_CATEGORY_MIXED');
  for(const l of d.lines){
    if(l.tax_category==='S'&&(l.tax_exemption_reason_code||l.tax_exemption_reason))throw Error('STANDARD_TAX_EXEMPTION_NOT_ALLOWED');
    if(l.tax_category!=='S'&&(!l.tax_exemption_reason_code||!l.tax_exemption_reason))throw Error('XML_TAX_REASON_REQUIRED');
    if(l.tax_category==='O'&&l.tax_exemption_reason_code!=='VATEX-SA-OOS')throw Error('OUT_OF_SCOPE_REASON_CODE_INVALID');
    // Unit codes are externally specified identifiers, never arbitrary XML names.
    if(!/^[A-Z0-9]{2,3}$/.test(l.unit_code))throw Error('XML_UNIT_CODE_INVALID');
    if(new Decimal(l.discount_amount).decimalPlaces()>2)throw Error('XML_DISCOUNT_PRECISION_INVALID');
  }
  const calculated=calculateVatEInvoiceDraft(d),t=calculated.totals;
  const money=(name:string,value:unknown,currency=d.currency)=>tag(`cbc:${name}`,value,` currencyID="${currency}"`);
  const reasonGroups=new Map<string,{code:string;reason:string}>();
  for(const line of d.lines){
    const key=`${line.tax_category}:${line.tax_rate.toFixed(2)}`,value={code:line.tax_exemption_reason_code||'',reason:line.tax_exemption_reason||''},old=reasonGroups.get(key);
    if(old&&(old.code!==value.code||old.reason!==value.reason))throw Error('XML_TAX_GROUP_REASON_MISMATCH');
    reasonGroups.set(key,value);
  }
  const subtotals=calculated.taxBreakdowns.map(b=>{
    const reason=reasonGroups.get(`${b.tax_category}:${b.tax_rate}`)!;
    return `<cac:TaxSubtotal>${money('TaxableAmount',b.taxable_amount)}${money('TaxAmount',b.tax_amount)}<cac:TaxCategory>${tag('cbc:ID',b.tax_category)}${b.tax_category==='O'?'':tag('cbc:Percent',b.tax_rate)}${reason.code?tag('cbc:TaxExemptionReasonCode',reason.code)+tag('cbc:TaxExemptionReason',reason.reason):''}${vatScheme}</cac:TaxCategory></cac:TaxSubtotal>`;
  }).join('');
  const lines=calculated.lines.map(l=>`<cac:InvoiceLine>${tag('cbc:ID',l.line_number)}${tag('cbc:InvoicedQuantity',new Decimal(l.quantity).toString(),` unitCode="${l.unit_code}"`)}${money('LineExtensionAmount',l.line_extension_amount)}${l.discount_amount>0?`<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>${money('Amount',new Decimal(l.discount_amount).toFixed(2))}</cac:AllowanceCharge>`:''}<cac:TaxTotal>${money('TaxAmount',l.tax_amount)}${money('RoundingAmount',l.gross_amount)}</cac:TaxTotal><cac:Item>${l.description?tag('cbc:Description',l.description):''}${tag('cbc:Name',l.item_name)}<cac:ClassifiedTaxCategory>${category(l.tax_category,new Decimal(l.tax_rate).toFixed(2))}</cac:ClassifiedTaxCategory></cac:Item><cac:Price>${money('PriceAmount',new Decimal(l.unit_price).toString())}${tag('cbc:BaseQuantity','1',` unitCode="${l.unit_code}"`)}</cac:Price></cac:InvoiceLine>`).join('');
  const type={INVOICE:'388',CREDIT_NOTE:'381',DEBIT_NOTE:'383'}[d.document_type];
  const invoiceTime=d.issue_time.length===5?d.issue_time+':00':d.issue_time;
  const taxSar=new Decimal(t.tax_total_amount).mul(d.exchange_rate).toFixed(2);
  const xml=`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ProfileID>reporting:1.0</cbc:ProfileID>${tag('cbc:ID',d.invoice_number)}${tag('cbc:UUID',context.invoiceUuid)}${tag('cbc:IssueDate',d.issue_date)}${tag('cbc:IssueTime',invoiceTime)}${d.due_date?tag('cbc:DueDate',d.due_date):''}${tag('cbc:InvoiceTypeCode',type,` name="${d.invoice_category==='STANDARD'?'0100000':'0200000'}"`)}${d.note_reason?tag('cbc:Note',d.note_reason):''}${tag('cbc:DocumentCurrencyCode',d.currency)}<cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>${d.document_type!=='INVOICE'?`<cac:BillingReference><cac:InvoiceDocumentReference>${tag('cbc:ID',d.billing_reference||d.preceding_invoice_id)}</cac:InvoiceDocumentReference></cac:BillingReference>`:''}<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID>${tag('cbc:UUID',context.invoiceCounter)}</cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment>${tag('cbc:EmbeddedDocumentBinaryObject',context.previousInvoiceHash,' mimeCode="text/plain"')}</cac:Attachment></cac:AdditionalDocumentReference>${party(d,'seller',context.sellerId)}${party(d,'buyer',context.buyerId)}<cac:Delivery>${tag('cbc:ActualDeliveryDate',context.supplyDate)}</cac:Delivery><cac:PaymentMeans>${tag('cbc:PaymentMeansCode',context.paymentMeansCode)}${d.document_type!=='INVOICE'?tag('cbc:InstructionNote',d.note_reason):''}</cac:PaymentMeans><cac:TaxTotal>${money('TaxAmount',taxSar,'SAR')}</cac:TaxTotal><cac:TaxTotal>${money('TaxAmount',t.tax_total_amount)}${subtotals}</cac:TaxTotal><cac:LegalMonetaryTotal>${money('LineExtensionAmount',t.line_extension_amount)}${money('TaxExclusiveAmount',t.tax_exclusive_amount)}${money('TaxInclusiveAmount',t.tax_inclusive_amount)}${money('AllowanceTotalAmount','0.00')}${money('PrepaidAmount','0.00')}${money('PayableAmount',t.payable_amount)}</cac:LegalMonetaryTotal>${lines}</Invoice>`;
  return {xml,invoiceUuid:context.invoiceUuid,documentTypeCode:type,transactionTypeCode:d.invoice_category==='STANDARD'?'0100000':'0200000',totals:t,stage:'UNSIGNED_PREPARATION' as const};
}
