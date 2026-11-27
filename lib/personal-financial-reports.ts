import Decimal from 'decimal.js';
import type {PersonalCashClass,PersonalReportEvidence} from './personal-report-evidence';
import type {personalCutoffEvidence,reconcilePersonalClassification} from './personal-report-v2-sources';
import type {readPersonalProfessionalIncome} from '../services/personal-professional-income';
import {cashStatement,registerPosition,type RegisterData} from './financial-register';

/** Personal reports are a read-only register view, not corporate journal postings. */
export type PersonalCategory='CASH'|'RECEIVABLE'|'LOAN_RECEIVABLE'|'SUPPLIER_ADVANCE'|'OTHER_ASSET'|'INVESTMENT'|'PAYABLE'|'LOAN_PAYABLE'|'CUSTOMER_ADVANCE';
export const PERSONAL_DEFAULT_CHART:ReadonlyArray<{id:PersonalCategory;code:string;ar:string;en:string;kind:'ASSET'|'LIABILITY'}>=[
 {id:'CASH',code:'1000',ar:'النقد والبنوك',en:'Cash and banks',kind:'ASSET'},
 {id:'RECEIVABLE',code:'1100',ar:'ذمم شخصية مدينة',en:'Personal receivables',kind:'ASSET'},
 {id:'LOAN_RECEIVABLE',code:'1200',ar:'قروض شخصية ممنوحة',en:'Personal loans receivable',kind:'ASSET'},
 {id:'SUPPLIER_ADVANCE',code:'1300',ar:'دفعات مقدمة',en:'Advance payments',kind:'ASSET'},
 // Personal valuables are not automatically corporate fixed assets (1500).
 {id:'OTHER_ASSET',code:'P-OTHER',ar:'أصول شخصية أخرى غير مصنفة',en:'Other unclassified personal assets',kind:'ASSET'},
 {id:'INVESTMENT',code:'1600',ar:'الاستثمارات',en:'Investments',kind:'ASSET'},
 {id:'PAYABLE',code:'2100',ar:'التزامات شخصية',en:'Personal payables',kind:'LIABILITY'},
 {id:'LOAN_PAYABLE',code:'2200',ar:'قروض شخصية مستحقة',en:'Personal borrowings',kind:'LIABILITY'},
 {id:'CUSTOMER_ADVANCE',code:'2400',ar:'دفعات مستلمة مقدمًا',en:'Advances received',kind:'LIABILITY'},
] as const;

export type PersonalReport={
 professionalIncome?:{currency:string;net:string;tax:string;count:number};
 professionalIncomeDocuments?:Awaited<ReturnType<typeof readPersonalProfessionalIncome>>;
 scope:'PERSONAL';basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE';asOf:string;from:string;to:string;baseCurrency:string;
 categories:Array<{id:PersonalCategory;code:string;ar:string;en:string;currency:string;amount:string;kind:'ASSET'|'LIABILITY'}>;
 positions:Array<{currency:string;cash:string;receivables:string;otherAssets:string;investments:string;liabilities:string;netWorth:string|null;complete:boolean;unreconciled:number;unallocated:string}>;
 cashAccounts:Array<{id:string;name:string;currency:string;opening:string;inflows:string;outflows:string;closing:string;netMovement:string;movementCount:number}>;
 /** Reconciles verified internal transfers. Remainders are gross movements after removing those transfers. */
 cashTransferReconciliation:Array<{currency:string;grossInflows:string;grossOutflows:string;verifiedInternalInflows:string;verifiedInternalOutflows:string;remainingUnclassifiedInflows:string;remainingUnclassifiedOutflows:string;verifiedPairs:number;unverifiedLegs:number;transferEvidenceComplete:boolean}>;
 cashByActivity:Array<{currency:string;activity:PersonalCashClass;inflows:string;outflows:string;net:string}>;
 recognizedIncome:PersonalReportEvidence['income'];
 historicalPosition:Array<{currency:string;cash:string|null;receivables:string|null;liabilities:string|null;
  supplierAdvances:string|null;customerAdvances:string|null}>;
 historicalAssetValuations?:PersonalReportEvidence['assetValuations'];
 classifiedActivity?:ReturnType<typeof reconcilePersonalClassification>;
 cutoffSources?:ReturnType<typeof personalCutoffEvidence>;
 purchaseFunding?:Array<{id:string;date:string;currency:string;payment:string;baseCurrency:string;
   assetBasis:string;cashBasis:string;realizedFx:string;reversed:boolean}>;
 issues:string[];
};

const D=Decimal.clone({precision:40});
const money=(value:number|string)=>{const d=new D(value);if(!d.isFinite())throw Error('PERSONAL_REPORT_AMOUNT_INVALID');return d.toDecimalPlaces(2).toFixed(2)};
const add=(values:Array<number|string>)=>money(values.reduce((sum,value)=>sum.plus(value),new D(0)).toString());

/** Never interpret money moving into a personal bank account as income.
 * A personal P&L requires separately classified, recognized income/expenses. */
export function personalFinancialReports(data:RegisterData,from:string,to:string,evidence:PersonalReportEvidence={cash:new Map(),income:[],issues:[]}):PersonalReport{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||to>data.asOf)throw Error('PERSONAL_REPORT_PERIOD_INVALID');
 if(data.organizationIds.length||data.accounts.some(a=>a.organizationId!==null||a.entityId!==null)||
  data.debts.some(d=>d.organizationId!==null)||data.assets.some(a=>a.organizationId!==null))throw Error('PERSONAL_REPORT_SCOPE_INVALID');
 const chart=PERSONAL_DEFAULT_CHART;
 const amounts=new Map<string,number[]>();
 const include=(id:PersonalCategory,currency:string,value:number)=>{if(!/^[A-Z]{3}$/.test(currency)||!Number.isFinite(value))throw Error('PERSONAL_REPORT_AMOUNT_INVALID');
  const key=id+':'+currency;amounts.set(key,[...(amounts.get(key)??[]),value]);};
 for(const a of data.accounts)include('CASH',a.baseCurrency,a.baseBalance);
 for(const d of data.debts){if(d.side==='UNAPPLIED')continue;
  const code:PersonalCategory=d.side==='RECEIVABLE'?(d.category==='P_AR_LOAN'?'LOAN_RECEIVABLE':'RECEIVABLE'):
   d.side==='SUPPLIER_ADVANCE'?'SUPPLIER_ADVANCE':d.side==='PAYABLE'?(d.category==='P_AP_LOAN'?'LOAN_PAYABLE':'PAYABLE'):'CUSTOMER_ADVANCE';
  include(code,d.currency,d.amount);}
 for(const a of data.assets){if(a.category==='LEGACY_CASH'||a.category==='LEGACY_RECEIVABLE')continue;
  include(a.category==='INVESTMENT'?'INVESTMENT':'OTHER_ASSET',a.currency,a.market);}
 const categories=[...amounts.entries()].map(([key,values])=>{
  const [id,currency]=key.split(':') as [PersonalCategory,string],template=chart.find(c=>c.id===id);
  if(!template)throw Error('PERSONAL_REPORT_CATEGORY_INVALID');return{...template,currency,amount:add(values)};
 }).sort((a,b)=>a.code.localeCompare(b.code)||a.currency.localeCompare(b.currency));
 const sourceUnverified=data.warnings.some(code=>code==='PERSONAL_CONTRACT_SCHEDULE_UNAVAILABLE');
 const positions=registerPosition(data.accounts,data.debts,data.assets).map(p=>{
  const investment=add(data.assets.filter(a=>a.category==='INVESTMENT'&&a.currency===p.currency).map(a=>a.market));
  const otherAssets=new D(p.market?money(p.market):'0').minus(investment).toString();
  const unallocated=add(data.debts.filter(d=>d.currency===p.currency&&d.side==='UNAPPLIED').map(d=>d.amount));
  return{currency:p.currency,cash:money(p.cash),receivables:money(p.receivables),otherAssets:money(otherAssets),investments:investment,
   liabilities:money(p.liabilities),netWorth:p.net===null||sourceUnverified?null:money(p.net),complete:p.net!==null&&!sourceUnverified,unreconciled:p.unreconciled,unallocated};
 });
 const cashMovementsByAccount=new Map<string,RegisterData['cashMovements']>();
 for(const movement of data.cashMovements){const rows=cashMovementsByAccount.get(movement.accountId);if(rows)rows.push(movement);else cashMovementsByAccount.set(movement.accountId,[movement]);}
 const cashAccounts=data.accounts.map(a=>{
  const s=cashStatement(a,cashMovementsByAccount.get(a.id)??[],from,to);return{id:a.id,name:a.name,currency:a.currency,
   opening:money(s.opening),inflows:money(s.inflows),outflows:money(s.outflows),closing:money(s.closing),
   netMovement:money(new D(s.closing).minus(s.opening).toString()),movementCount:s.lines.length};
 });
 // Only an actual persisted transfer_id linking exactly one OUT transaction to
 // one IN transaction can remove a pair from gross account activity. Never
 // pair arbitrary equal amounts, dates, notes or user-facing references.
 const accountById=new Map(data.accounts.map(a=>[a.id,a]));
 const activity=data.cashMovements.filter(m=>!m.isOpening&&m.date>=from&&m.date<=to&&accountById.get(m.accountId)?.currency===m.currency);
 const groups=new Map<string,typeof activity>();
 const recordedAsOf=data.cashMovements.filter(m=>m.date<=to);
 const reversalTargets=new Set(recordedAsOf.map(m=>m.reversalOfTransactionId).filter((id):id is string=>Boolean(id)));
 const investmentCash=(id:string)=>evidence.investmentCashIds?.has(id);
 const selectedTransferIds=new Set(activity.filter(m=>!investmentCash(m.id)).map(m=>m.internalTransferId).filter(Boolean));
 for(const m of recordedAsOf.filter(m=>m.internalTransferId&&selectedTransferIds.has(m.internalTransferId)&&!investmentCash(m.id))){
  const key=m.internalTransferId!;groups.set(key,[...(groups.get(key)??[]),m]);
 }
 const verifiedIds=new Set<string>();let hasUnverifiedTransfers=false;
 for(const legs of groups.values()){
  const [out,incoming]=[legs.find(m=>m.transactionType==='TRANSFER_OUT'),legs.find(m=>m.transactionType==='TRANSFER_IN')];
  const eligible=legs.length===2&&Boolean(out&&incoming)&&out!.source==='ASSETS'&&incoming!.source==='ASSETS'&&
   out!.accountId!==incoming!.accountId&&out!.id!==incoming!.id&&out!.currency===incoming!.currency&&out!.date===incoming!.date&&
   new D(out!.amount).lt(0)&&new D(incoming!.amount).gt(0)&&new D(out!.amount).plus(incoming!.amount).isZero()&&
   !legs.some(m=>reversalTargets.has(m.id)||!Number.isFinite(m.amount)||m.isOpening||m.date<from||accountById.get(m.accountId)?.currency!==m.currency);
  if(eligible){verifiedIds.add(out!.id);verifiedIds.add(incoming!.id);}else{hasUnverifiedTransfers=true;}
  // A shared ID by itself cannot validate a transfer if the original legs
  // have been reversed, missing, cross-currency or otherwise inconsistent.
 }
 if(activity.some(m=>(m.transactionType==='TRANSFER_IN'||m.transactionType==='TRANSFER_OUT')&&!investmentCash(m.id)&&!verifiedIds.has(m.id)))hasUnverifiedTransfers=true;
 const cashTransferReconciliation=[...new Set(cashAccounts.map(a=>a.currency))].sort().map(currency=>{
  const accounts=cashAccounts.filter(a=>a.currency===currency),rows=activity.filter(m=>m.currency===currency),verified=rows.filter(m=>verifiedIds.has(m.id));
  const grossInflows=add(accounts.map(a=>a.inflows)),grossOutflows=add(accounts.map(a=>a.outflows));
  const verifiedInternalInflows=add(verified.filter(m=>m.amount>0).map(m=>m.amount));
  const verifiedInternalOutflows=add(verified.filter(m=>m.amount<0).map(m=>-m.amount));
  const unverifiedLegs=rows.filter(m=>(m.transactionType==='TRANSFER_IN'||m.transactionType==='TRANSFER_OUT'||Boolean(m.internalTransferId))&&!investmentCash(m.id)&&!verifiedIds.has(m.id)).length;
  return{currency,grossInflows,grossOutflows,verifiedInternalInflows,verifiedInternalOutflows,
   remainingUnclassifiedInflows:money(new D(grossInflows).minus(verifiedInternalInflows).toString()),
   remainingUnclassifiedOutflows:money(new D(grossOutflows).minus(verifiedInternalOutflows).toString()),
   verifiedPairs:verified.length/2,unverifiedLegs,transferEvidenceComplete:unverifiedLegs===0};
 });
 const purchaseFunding=activity.flatMap(m=>{
  const funding=m.purchaseFunding;
  if(!funding || m.source!=='ASSETS'||funding.base_currency!==m.currency)return [];
  const direction=funding.reversed?-1:1;
  if(!new D(m.amount).eq(new D(funding.cash_basis_base).times(-direction)))return [];
  return [{id:m.id,date:m.date,currency:funding.payment_currency,baseCurrency:funding.base_currency,
   payment:new D(funding.payment_amount).times(direction).toString(),
   assetBasis:new D(funding.asset_basis_base).times(direction).toString(),
   cashBasis:new D(funding.cash_basis_base).times(direction).toString(),
   realizedFx:new D(funding.realized_fx_base).times(direction).toString(),reversed:funding.reversed}];
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const cashByActivity:PersonalReport['cashByActivity']=[];
 const cashClass=(row:typeof activity[number]):PersonalCashClass=>{
  return evidence.cash.get(row.id)??evidence.cash.get(row.reversalOfTransactionId??'')??'UNCLASSIFIED';
 };
 const cashCurrencySet=[...new Set(activity.map(row=>row.currency))].sort();
 for(const currency of cashCurrencySet){
  const external=activity.filter(row=>row.currency===currency&&!verifiedIds.has(row.id));
  for(const category of ['OPERATING','INVESTING','FINANCING','UNCLASSIFIED'] as const){
   const amounts=external.filter(row=>cashClass(row)===category).map(row=>row.amount);
   if(!amounts.length)continue;
   cashByActivity.push({currency,activity:category,inflows:add(amounts.filter(n=>n>0)),
    outflows:add(amounts.filter(n=>n<0).map(n=>-n)),net:add(amounts)});
  }
 }
 const recognizedIncome=evidence.income.filter(row=>row.date>=from&&row.date<=to);
 const historicalPosition=to===data.asOf?[]:historicalMonetaryPosition(data,to,evidence.unverifiedPayableCurrencies);
 const historicalAssetValuations=to===data.asOf?[]:(evidence.assetValuations??[]).filter(row=>row.date===to);
 const issues=[...data.warnings,...evidence.issues];
 if(to<data.asOf)issues.push(historicalAssetValuations.length?'PERSONAL_HISTORICAL_ASSET_VALUES_PARTIAL':'PERSONAL_HISTORICAL_ASSET_VALUES_UNAVAILABLE');
 if(positions.some(p=>!p.complete))issues.push('PERSONAL_POSITION_RECONCILIATION_REQUIRED');
 if(positions.length>1)issues.push('PERSONAL_MULTI_CURRENCY_NOT_AGGREGATED');
 issues.push('PERSONAL_INCOME_EXPENSE_CLASSIFICATION_PENDING','PERSONAL_CASH_GROSS_INCLUDES_INTERNAL_TRANSFERS');
 if(hasUnverifiedTransfers)issues.push('PERSONAL_TRANSFER_PROVENANCE_INCOMPLETE');
 return{scope:'PERSONAL',basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE',asOf:data.asOf,from,to,baseCurrency:data.baseCurrency,categories,positions,cashAccounts,cashTransferReconciliation,cashByActivity,recognizedIncome,historicalPosition,historicalAssetValuations,purchaseFunding,issues:[...new Set(issues)]};
}


/** A dated monetary subset. Current assets and valuations may not be used at
 * a historic cutoff. A component is available only if its dated movements
 * reconcile to the current register, including opening and reversal rows.
 */
function historicalMonetaryPosition(data:RegisterData,to:string,unverifiedPayableCurrencies:ReadonlySet<string>=new Set()):PersonalReport['historicalPosition']{
 const currencies=[...new Set([
  ...data.accounts.map(a=>a.baseCurrency),...data.debts.map(d=>d.currency),...data.debtMovements.map(d=>d.currency),...unverifiedPayableCurrencies,
 ])].sort();
 const knownCashTypes=new Set(['OPENING_BALANCE','ADD','WITHDRAWAL','TRANSFER_IN','TRANSFER_OUT','ZAKAT_PAYMENT','REVERSAL','ADJUSTMENT','SALE']);
 const total=(amounts:number[])=>amounts.reduce((sum,amount)=>sum.plus(amount),new D(0));
 return currencies.map(currency=>{
  const accounts=data.accounts.filter(a=>a.baseCurrency===currency);
  const holdings=accounts.map(account=>{
   const rows=data.cashMovements.filter(row=>row.accountId===account.id&&row.date<=data.asOf);
   if(rows.some(row=>row.currency!==currency||!knownCashTypes.has(row.transactionType??''))||
    new Set(rows.map(row=>row.id)).size!==rows.length||
    !total(rows.map(row=>row.amount)).toDecimalPlaces(8).eq(new D(account.baseBalance).toDecimalPlaces(8)))return null;
   return total(rows.filter(row=>row.date<=to).map(row=>row.amount));
  });
  const cash=holdings.some(v=>v===null)?null:money(holdings.reduce<Decimal>((sum,value)=>sum.plus(value??0),new D(0)).toString());
  const debts=data.debts.filter(d=>d.currency===currency);
  const movements=data.debtMovements.filter(d=>d.currency===currency&&d.date<=data.asOf);
  const uncertain=data.warnings.includes('PERSONAL_CONTRACT_SCHEDULE_UNAVAILABLE')||debts.some(d=>d.side==='UNAPPLIED')||
   movements.some(m=>m.organizationId!=='PERSONAL')||
   new Set(movements.map(m=>m.id)).size!==movements.length;
  const historicalDebt=(side:typeof debts[number]['side'],reportSide:'SALES'|'PURCHASE',advance:boolean)=>{
   if(uncertain||unverifiedPayableCurrencies.has(currency)&&['PAYABLE','CUSTOMER_ADVANCE'].includes(side))return null;
   const current=new Map<string,Decimal>();
   for(const debt of debts.filter(d=>d.side===side)){
    const id=debt.sourceDebtId??debt.id;
    current.set(id,(current.get(id)??new D(0)).plus(debt.amount));
   }
   const rows=movements.filter(m=>m.side===reportSide&&m.advance===advance);
   const recorded=new Map<string,Decimal>();
   for(const row of rows){
    if(!row.debtId)return null;
    recorded.set(row.debtId,(recorded.get(row.debtId)??new D(0)).plus(advance?-row.amount:row.amount));
   }
   for(const id of new Set([...current.keys(),...recorded.keys()])){
    if(!(recorded.get(id)??new D(0)).toDecimalPlaces(4).eq((current.get(id)??new D(0)).toDecimalPlaces(4)))return null;
   }
   return money(total(rows.filter(row=>row.date<=to).map(row=>advance?-row.amount:row.amount)).toString());
  };
  return {currency,cash,receivables:historicalDebt('RECEIVABLE','SALES',false),liabilities:historicalDebt('PAYABLE','PURCHASE',false),
   supplierAdvances:historicalDebt('SUPPLIER_ADVANCE','PURCHASE',true),customerAdvances:historicalDebt('CUSTOMER_ADVANCE','SALES',true)};
 });
}
