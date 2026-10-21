import {assetPurchaseAmounts} from './asset-purchase-workspace';
export const assetTaxCategories=[['S','أساسي','Standard'],['Z','صفري','Zero-rated'],['E','معفى','Exempt'],['O','خارج النطاق','Out of scope']] as const;
/** Use the same S/Z/E/O categories as invoice entry; hidden taxable values never leak. */
export function assetEntryTaxSettings(form:Record<string,any>,net:number,validateReasons=true){
 const taxablePurchase=form.acquisition_mode==='PURCHASE'&&form.ownership_scope==='ORGANIZATION';
 const category=taxablePurchase?(form.tax_category||'S'):'O';
 if(!assetTaxCategories.some(([c])=>c===category))throw Error('ASSET_TAX_CATEGORY_INVALID');
 const mode=form.vat_input_mode==='AMOUNT'?'AMOUNT':'PERCENT';
 const amounts=assetPurchaseAmounts(net,category==='S'?(mode==='PERCENT'?form.vat_rate:form.vat_amount):0,category==='S'?mode:'AMOUNT');
 if(category==='S'&&((mode==='PERCENT'&&Number(form.vat_rate)<=0)||(net>0&&amounts.tax<=0)))throw Error('ASSET_STANDARD_TAX_REQUIRED');
 const reasonCode=String(form.tax_exemption_reason_code||'').trim(),reason=String(form.tax_exemption_reason||'').trim();
 if(validateReasons&&['Z','E'].includes(category)&&(!reasonCode||!reason||reasonCode.length>20||reason.length>500))throw Error('ASSET_TAX_REASON_REQUIRED');
 return {amounts,metadata:{tax_category:category,vat_input_mode:category==='S'?mode:'AMOUNT',vat_rate:category==='S'&&mode==='PERCENT'?Number(form.vat_rate):0,vat_amount:amounts.tax,recoverable_percent:category==='S'?Number(form.recoverable_percent??100):0,tax_exemption_reason_code:['Z','E','O'].includes(category)?reasonCode:null,tax_exemption_reason:['Z','E','O'].includes(category)?reason:null}};
}
