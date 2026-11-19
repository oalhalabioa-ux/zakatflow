import type {StudySupplier} from './engine';
import {waterCapexItemKeys,type WaterCapexItemKey,type WaterModel} from './water-model';

export const waterCapexCategories:Record<WaterCapexItemKey,readonly [string,string]>={
 buildings:['مبانٍ وإنشاءات','Buildings'],line:['معدات إنتاج','Production equipment'],
 treatment:['معدات إنتاج','Production equipment'],power:['مرافق','Utilities'],
 lab:['معدات','Equipment'],vehicles:['وسائل نقل','Vehicles'],
 licenses:['رسوم وتأسيس','Licences and setup'],others:['أخرى','Other'],
};

/** Explicit one-item replacement, never automatic cheapest-quote selection or aggregation. */
export function applyWaterCapexQuote(water:WaterModel,quotes:readonly StudySupplier[],quoteId:string,
 target:WaterCapexItemKey,currency:string,confirmed:boolean,now=new Date().toISOString()):WaterModel|null{
 const matches=quotes.filter(q=>q.id===quoteId),quote=matches[0];
 if(water.quantityCosting?.capital.enabled||confirmed!==true||!quoteId.trim()||!waterCapexItemKeys.includes(target)||matches.length!==1||!quote||quote.status==='REJECTED'||
  !/^[A-Z]{3}$/.test(currency)||!quote.vendor.trim()||!quote.item.trim()||
  quote.id.length>100||quote.vendor.trim().length>300||quote.item.trim().length>500||
  !Number.isFinite(quote.offer)||quote.offer<0||quote.offer>1e12||!Number.isFinite(Date.parse(now)))return null;
 return {...water,capex:{...water.capex,[target]:quote.offer},capexQuoteSources:{...water.capexQuoteSources,
  [target]:{quoteId:quote.id,vendor:quote.vendor.trim(),item:quote.item.trim(),amount:quote.offer,currency,importedAt:new Date(now).toISOString()}}};
}
