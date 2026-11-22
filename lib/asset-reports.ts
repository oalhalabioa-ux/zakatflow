import Decimal from 'decimal.js';
import {currentAssetValuation} from './asset-statement';
import {operationReportState} from './asset-operation-report';
export type AssetReportScope={scope:string;organizationId:string;organizationIds?:string[];entityId:string;query:string;category:string;status:string};
export function assetReportState(asset:any){if(asset.metadata?.investment_id)return ['ACTIVE','CLOSED'].includes(asset.metadata.investment_status)?'ACTUAL':asset.metadata.investment_status??'DRAFT';return asset.financial_event_status??(asset.organization_id&&asset.metadata?.acquisition_mode==='PURCHASE'?'UNLINKED':'RECORDED');}
export function isRecognizedAsset(asset:any){return ['RECORDED','ACTUAL'].includes(assetReportState(asset));}
export function filterReportAssets(assets:any[],filter:AssetReportScope){return assets.filter(a=>{
 const organization=a.ownership_scope==='ORGANIZATION'||Boolean(a.organization_id);
 return (filter.scope==='ORGANIZATION'?organization&&(filter.organizationIds??[filter.organizationId]).includes(a.organization_id):!organization)&&(!filter.entityId||a.entity_id===filter.entityId)&&(!filter.category||(a.asset_class_code??a.asset_type)===filter.category)&&(!filter.status||(filter.status==='POSTED'?isRecognizedAsset(a):!isRecognizedAsset(a)))&&(!filter.query||`${a.name} ${a.asset_type} ${a.metadata?.invoice_reference??''}`.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase()));
});}
type ValuationAsset={
 asset_type:string;
 currency:string;
 current_value_currency?:string|null;
 current_quantity?:number|string|null;
 current_cost_value?:number|string|null;
 metadata?:Record<string,unknown>|null;
};
export function assetReportValuation(asset:ValuationAsset,date:string){
 const metadata=asset.metadata??{};
 const quantity=asset.current_quantity,cost=asset.current_cost_value;
 if(quantity==null||cost==null||!Number.isFinite(Number(quantity))||!Number.isFinite(Number(cost)))return null;
 if(Number(quantity)<0||Number(cost)<0)return null;
 if(typeof metadata.market_price_source!=='string'||!metadata.market_price_source.trim()||
    typeof metadata.market_valuation_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(metadata.market_valuation_date))return null;
 return currentAssetValuation({
  type:asset.asset_type,currency:asset.currency,baseCurrency:asset.current_value_currency??asset.currency,
  quantity:String(quantity),cost:String(cost),metadata,date,
 });
}
export function reportAssetTotals(assets:any[],date:string){
 const recognized=assets.filter(isRecognizedAsset);
 const groups=new Map<string,{
  currency:string;cost:Decimal;market:Decimal;valuedCost:Decimal;count:number;valued:number;eligible:Decimal;zakat:Decimal;
 }>();
 for(const asset of recognized){
  const currency=asset.current_value_currency??asset.currency;
  const group=groups.get(currency)??{
   currency,cost:new Decimal(0),market:new Decimal(0),valuedCost:new Decimal(0),count:0,valued:0,
   eligible:new Decimal(0),zakat:new Decimal(0),
  };
  group.cost=group.cost.add(asset.current_cost_value??0);
  group.count++;
  const valuation=assetReportValuation(asset,date);
  if(valuation){
   group.market=group.market.add(valuation.value);
   group.valuedCost=group.valuedCost.add(asset.current_cost_value);
   group.valued++;
  }
  if(asset.zakat_calculation?.currency===currency){
   group.eligible=group.eligible.add(asset.zakat_calculation.eligible_value??0);
   group.zakat=group.zakat.add(asset.zakat_calculation.zakat_amount??0);
  }
  groups.set(currency,group);
 }
 return {drafts:assets.length-recognized.length,recognized:recognized.length,groups:[...groups.values()].map(group=>{
  const gain=group.market.minus(group.valuedCost);
  return {
   currency:group.currency,count:group.count,valued:group.valued,cost:group.cost.toNumber(),
   market:group.valued?group.market.toNumber():null,gain:group.valued?gain.toNumber():null,
   percent:group.valuedCost.gt(0)?gain.div(group.valuedCost).mul(100).toNumber():null,
   eligible:group.eligible.toNumber(),zakat:group.zakat.toNumber(),
  };
 })};
}
export function filterReportMovements(rows:any[],assets:any[],from:string,to:string){const ids=new Set(assets.map(a=>a.id));return rows.filter(r=>ids.has(r.asset_account_id)&&(!from||r.transaction_date>=from)&&(!to||r.transaction_date<=to));}
export function postedReportMovements(rows:any[]){return rows.filter(r=>['ACTUAL','RECORDED'].includes(operationReportState(r))&&!r.metadata?.lifecycle_reversed&&!r.metadata?.asset_deleted);}
