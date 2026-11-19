import type {FeasibilityStudy} from './engine';
import {evaluateQuantityBudget} from './quantity-costs';
import {effectiveWaterInputs} from './water-model';

/** Read-only cost evidence; figures in the same currency as the study, without FX conversion. */
export function costingReportRows(study:Pick<FeasibilityStudy,'water'|'rawLand'>){
 if(study.water){
  const m=study.water,e=effectiveWaterInputs(m);
  return [
   ...(m.quantityCosting?.capital.enabled?e.capital.rows.map(x=>({...x,period:'CAPITAL'})):[]),
   ...(m.quantityCosting?.fixed.enabled?e.fixed.rows.map(x=>({...x,period:'MONTH'})):[]),
  ];
 }
 const m=study.rawLand;
 if(!m?.quantityDevelopment?.budget.enabled)return [];
 const net=Math.max(0,m.site.areaAfterPriorTransfers-m.site.excludedValley-m.site.extraExcluded-m.site.otherConstraintsSqm);
 const q=m.quantityDevelopment;
 return evaluateQuantityBudget(q.budget,{LAND_AREA:m.site.areaAfterPriorTransfers,NET_AREA:net,SALE_AREA:net*(1-m.site.serviceRatio),
  ROAD_LENGTH:q.roadLength,NETWORK_LENGTH:q.networkLength,SERVICE_AREA:q.serviceAreaFromSite?net*m.site.serviceRatio:q.serviceArea}).rows.map(x=>({...x,period:'DEVELOPMENT'}));
}
