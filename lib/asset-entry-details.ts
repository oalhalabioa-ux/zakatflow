export type AssetEntryRate={id:string;organization_id:string|null;from_currency:string;to_currency:string;rate:number;valuation_date:string;source:string};
/** Saved transaction quotes only: never use display pegs or future rates. */
export function assetEntryQuote(rates:AssetEntryRate[],currency:string,base:string,date:string,organizationId:string|null){
 if(currency===base)return {rate:1,row:null};
 const rows=rates.filter(r=>(r.organization_id===null||r.organization_id===organizationId)&&r.valuation_date<=date&&Number.isFinite(Number(r.rate))&&Number(r.rate)>0&&((r.from_currency===currency&&r.to_currency===base)||(r.to_currency===currency&&r.from_currency===base))).sort((a,b)=>Number(Boolean(b.organization_id))-Number(Boolean(a.organization_id))||b.valuation_date.localeCompare(a.valuation_date)||b.id.localeCompare(a.id));
 const row=rows[0];if(!row)return null;
 return {rate:row.from_currency===currency?Number(row.rate):1/Number(row.rate),row};
}
export function acquisitionValuation(metadata:Record<string,any>,currency:string){
 if(metadata.acquisition_mode!=='PURCHASE')return metadata;
 const value=Number(metadata.purchase_value),quantity=Number(metadata.quantity||1);
 if(!Number.isFinite(value)||value<0||!Number.isFinite(quantity)||quantity<=0)throw Error('ASSET_PURCHASE_VALUE_INVALID');
 return {...metadata,market_value:value,estimated_value:value,market_price:value/quantity,market_price_per_unit:value/quantity,market_price_currency:currency,market_valuation_date:metadata.purchase_date,market_price_source:'ACQUISITION_COST',market_value_auto:false};
}
