import Decimal from 'decimal.js';
export interface AssessmentLot {lotId:string;marketValueBase:Decimal.Value;hawlCompleted:boolean;receiptComponents?:ReadonlyArray<{remainingBase:Decimal.Value;hawlCompleted:boolean}>;externalCoveredDays?:number;hawlPeriodDays?:number;}
function receiptBasis(lot:AssessmentLot,market:Decimal):Decimal {
 const components=lot.receiptComponents;
 if(!components)return lot.hawlCompleted?market:new Decimal(0);
 let total=new Decimal(0), mature=new Decimal(0);
 for(const component of components){
  const amount=new Decimal(component.remainingBase);
  if(!amount.isFinite()||amount.lt(0))throw new Error('INVALID_RECEIPT_COMPONENT_AMOUNT');
  total=total.plus(amount);
  if(component.hawlCompleted)mature=mature.plus(amount);
 }
 if(!total.eq(market)||lot.hawlCompleted!==mature.gt(0)||lot.externalCoveredDays)
  throw new Error('RECEIPT_COMPONENT_BASIS_MISMATCH');
 return mature;
}
export function calculateAssessment(lots:AssessmentLot[],nisabValueBase:Decimal.Value,rate:Decimal.Value=new Decimal('0.025'),nisabPoolValueBase?:Decimal.Value){const nisab=new Decimal(nisabValueBase);const r=new Decimal(rate);const lines=lots.map(l=>{const market=new Decimal(l.marketValueBase);const covered=l.externalCoveredDays??0;const days=l.hawlPeriodDays??0;if(!Number.isInteger(covered)||covered<0||(covered>0&&(!Number.isInteger(days)||days<=0||covered>days)))throw new Error('INVALID_EXTERNAL_ZAKAT_COVERAGE');const factor=covered?new Decimal(days-covered).div(days):new Decimal(1);return {lotId:l.lotId,marketValueBase:market,eligibleValue:receiptBasis(l,market).mul(factor),zakatAmount:new Decimal(0),status:l.hawlCompleted?'ELIGIBLE':'HAWL_NOT_COMPLETED',explanation:l.hawlCompleted?(covered?`Institution covers ${covered} of ${days} Hawl days; only the uncovered period enters the internal basis. No cash payment is recorded.`:'Hawl completed under selected ruleset.'):'Hawl has not completed under selected ruleset.'}});const total=lines.reduce((s,l)=>s.add(l.eligibleValue),new Decimal(0));const qualifies=new Decimal(nisabPoolValueBase??total).gte(nisab);for(const l of lines){if(qualifies)l.zakatAmount=l.eligibleValue.mul(r);else if(l.status==='ELIGIBLE'){l.status='BELOW_NISAB';l.explanation='Total eligible wealth is below the selected Nisab.';}}return {nisabValueBase:nisab,totalEligibleValue:qualifies?total:new Decimal(0),rate:r,zakatDue:qualifies?total.mul(r):new Decimal(0),lines};}
