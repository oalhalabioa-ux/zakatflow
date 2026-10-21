import Decimal from 'decimal.js';
export type InvoiceSource = 'INVOICING' | 'ASSETS' | 'CUSTODY';
export const invoiceSourceLabel = (source: InvoiceSource | undefined, ar: boolean) => source === 'ASSETS' ? (ar ? 'الأصول' : 'Assets') : source === 'CUSTODY' ? (ar ? 'العهد' : 'Custody') : (ar ? 'إدارة الفواتير' : 'Invoicing');
export type AssetInvoiceTransaction = { purchase_number?:string|null; id:string; organization_id:string; asset_account_id:string; transaction_type:string; transaction_date:string; reference:string|null; currency:string; base_currency:string; gross_value:string|number; base_value:string|number; metadata:Record<string,any>; reversal_of_transaction_id?:string|null };
export type AssetInvoiceEvent = {id:string;organization_id:string;source_module:string;source_record_id:string|null;status:string;counterparty_id:string|null;due_date:string|null};
/** Read projections only: acquisition gross_value is NET, while VAT remains in frozen metadata. */
export function assetPurchaseInvoices(transactions:AssetInvoiceTransaction[], events:AssetInvoiceEvent[], parties:Array<{id:string;organization_id:string;name:string}>, bound:Array<{organization_id:string;asset_transaction_id?:string|null}>) {
 const aliases=new Set(bound.filter(d=>d.asset_transaction_id).map(d=>`${d.organization_id}:${d.asset_transaction_id}`));
 const byEvent=new Map(events.map(e=>[e.id,e]));
 const names=new Map(parties.map(p=>[`${p.organization_id}:${p.id}`,p.name]));
 return transactions.flatMap(t=>{
  const m=t.metadata||{},e=byEvent.get(m.financial_event_id),reference=(t.reference||m.invoice_reference||'').trim();
  if(t.transaction_type!=='PURCHASE'||t.reversal_of_transaction_id||m.deleted_at||m.asset_deleted||!reference||!e||e.organization_id!==t.organization_id||e.source_module!=='ASSETS_INTEGRATION'||e.source_record_id!==t.id||e.status==='CANCELLED'||!e.counterparty_id||aliases.has(`${t.organization_id}:${t.id}`))return [];
  const net=new Decimal(t.gross_value),vat=new Decimal(m.vat_amount||0),fx=new Decimal(m.fx_rate||1);
  if(!net.isFinite()||!vat.isFinite()||!fx.isFinite()||net.lte(0)||vat.lt(0)||fx.lte(0))throw new Error('INVALID_ASSET_INVOICE');
  return [{id:t.id,assetId:t.asset_account_id,organizationId:t.organization_id,eventId:e.id,accountingStatus:e.status,partyId:e.counterparty_id,purchaseNumber:t.purchase_number??null,partyName:names.get(`${t.organization_id}:${e.counterparty_id}`)||'—',reference,date:t.transaction_date,due:e.due_date,currency:t.currency,baseCurrency:t.base_currency,net:net.toNumber(),tax:vat.toNumber(),total:net.plus(vat).toNumber(),baseNet:new Decimal(t.base_value).toNumber(),baseTax:vat.mul(fx).toNumber(),baseTotal:new Decimal(t.base_value).plus(vat.mul(fx)).toNumber()}];
 });
}
