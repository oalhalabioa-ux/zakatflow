import {assetPurchaseAmounts} from './asset-purchase-workspace';
/** VAT belongs only to a purchase; hidden purchase inputs must not leak into openings. */
export function assetEntryTax(mode:string,net:number,vatMode:'PERCENT'|'AMOUNT',rate:unknown,amount:unknown,scope='ORGANIZATION'){
 return mode==='PURCHASE'&&scope==='ORGANIZATION'?assetPurchaseAmounts(net,vatMode==='PERCENT'?rate:amount,vatMode).tax:0;
}
export function assetEntryAmount(value:number,currency:string){return `${new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number.isFinite(value)?value:0)} ${currency}`;}
export function financialOpeningFromAsset(asset:any,requestId:string){
 const m=asset.metadata??{};
 return {request_id:requestId,scope:asset.ownership_scope,organization_id:asset.organization_id??null,entity_id:asset.entity_id??null,type:asset.asset_type,name:asset.name,currency:asset.currency,opening_balance:Number(m.purchase_value??m.opening_value??0),opening_date:m.purchase_date,hawl_start_date:asset.ownership_scope==='PERSONAL'?(m.hawl_start_date||m.purchase_date):null,fx_rate:Number(m.fx_rate),due_date:m.due_date||null,notes:m.notes||'',...(asset.asset_type==='RECEIVABLE'?{debt_category:m.debt_category}:{})};
}
